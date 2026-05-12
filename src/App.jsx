import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Search, 
  MessageSquare, 
  X, 
  Menu, 
  Trash2, 
  Send, 
  Square, 
  Moon, 
  Sun, 
  Terminal,
  Copy,
  Check,
  Paperclip,
  Image as ImageIcon,
  Camera,
  Edit2
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import './App.css';

// Initialize PDF.js worker using a stable version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs`;

// --- Constants & Config ---
const CONFIG = {
  host: 'https://congressional-eve-hoppingly.ngrok-free.dev',
  model: 'qwen3',
  apiKey: 'sk-raahim-secret-key'
};

function App() {
  const [error, setError] = useState(null);
  
  // --- State ---
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem('zyntax_sessions');
      return saved ? JSON.parse(saved) : { default: [] };
    } catch (e) {
      console.error("Session load error:", e);
      return { default: [] };
    }
  });
  const [currentSessionName, setCurrentSessionName] = useState(() => {
    return localStorage.getItem('zyntax_current_session') || 'default';
  });
  const [renamingSession, setRenamingSession] = useState(null);
  const [newName, setNewName] = useState('');
  
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('zyntax_theme') || 'dark';
  });
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [searchQuery, setSearchQuery] = useState('');
  const [userInput, setUserInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]); 
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  
  const [totalTokens, setTotalTokens] = useState(0);
  const [tokenSpeed, setTokenSpeed] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant running locally via Ollama. Be concise, accurate, and technical when needed.');
  
  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const sessionStartRef = useRef(Date.now());

  // --- Derived State ---
  const conversation = sessions[currentSessionName] || [];

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('zyntax_sessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('zyntax_current_session', currentSessionName);
  }, [currentSessionName]);

  useEffect(() => {
    localStorage.setItem('zyntax_theme', theme);
    if (theme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionTime(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [conversation, isGenerating]);

  // --- Handlers ---
  const startCamera = async () => {
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera error:", err);
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject;
    stream?.getTracks().forEach(track => track.stop());
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const data = canvas.toDataURL('image/jpeg');
    
    setAttachedFiles(prev => [...prev, {
      name: `Photo-${Date.now()}.jpg`,
      data: data,
      type: 'image/jpeg',
      isImage: true,
      extractedText: ''
    }]);
    stopCamera();
  };

  const handleRename = (oldName) => {
    if (!newName.trim() || newName === oldName) {
      setRenamingSession(null);
      return;
    }
    setSessions(prev => {
      const newSessions = { ...prev };
      newSessions[newName] = newSessions[oldName];
      delete newSessions[oldName];
      return newSessions;
    });
    if (currentSessionName === oldName) setCurrentSessionName(newName);
    setRenamingSession(null);
    setNewName('');
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    setIsProcessingFile(true);
    try {
      const processedFiles = await Promise.all(files.map(async (file) => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onerror = () => resolve(null);
          reader.onload = async (event) => {
            const base64Data = event.target.result;
            if (!base64Data) return resolve(null);

            const fileData = {
              name: file.name,
              data: base64Data,
              type: file.type,
              isImage: file.type.startsWith('image/'),
              isPDF: file.type === 'application/pdf',
              extractedText: ''
            };

            try {
              if (fileData.isImage) {
                const { data: { text } } = await Tesseract.recognize(base64Data);
                fileData.extractedText = text;
              } else if (fileData.isPDF) {
                const binaryStr = atob(base64Data.split(',')[1]);
                const pdf = await pdfjsLib.getDocument({ data: binaryStr }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                  const page = await pdf.getPage(i);
                  const content = await page.getTextContent();
                  fullText += content.items.map(item => item.str).join(' ') + '\n';
                }
                fileData.extractedText = fullText;
              }
            } catch (innerErr) {
              console.warn("Extraction failed for", file.name, innerErr);
            }
            resolve(fileData);
          };
          reader.readAsDataURL(file);
        });
      }));
      setAttachedFiles(prev => [...prev, ...processedFiles.filter(f => f !== null)]);
    } catch (err) {
      console.error("File processing failed:", err);
    } finally {
      setIsProcessingFile(false);
      e.target.value = '';
    }
  };

  const removeAttachment = (index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  const toggleSidebar = () => setSidebarOpen(prev => !prev);

  const startNewChat = () => {
    const name = `Chat ${new Date().toLocaleString('en-GB', { hour12: false }).replace(',', '')}`;
    setSessions(prev => ({ ...prev, [name]: [] }));
    setCurrentSessionName(name);
    setSearchQuery('');
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const resumeSession = (name) => {
    setCurrentSessionName(name);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const deleteSession = (e, name) => {
    e.stopPropagation();
    if (name === 'default') return;
    setSessions(prev => {
      const newSessions = { ...prev };
      delete newSessions[name];
      return newSessions;
    });
    if (currentSessionName === name) {
      setCurrentSessionName('default');
    }
  };

  const clearMessages = () => {
    setSessions(prev => ({ ...prev, [currentSessionName]: [] }));
  };

  const handleSendMessage = async () => {
    if (isGenerating) {
      abortControllerRef.current?.abort();
      return;
    }

    const text = userInput.trim();
    if (!text && attachedFiles.length === 0) return;

    if (text.startsWith('/') && attachedFiles.length === 0) {
      handleSlashCommand(text);
      setUserInput('');
      return;
    }

    const newUserMessage = { 
      role: 'user', 
      content: text, 
      attachments: attachedFiles,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }) 
    };
    
    const updatedConversation = [...conversation, newUserMessage];
    setSessions(prev => ({ ...prev, [currentSessionName]: updatedConversation }));
    setUserInput('');
    setAttachedFiles([]);
    setIsGenerating(true);

    const apiMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];

    updatedConversation.forEach(msg => {
      if (msg.role === 'system') return;
      if (msg.role === 'user') {
        const content = [];
        let combinedText = msg.content || '';
        msg.attachments?.forEach(file => {
          if (file.extractedText) combinedText += `\n\n[Content from ${file.name}]:\n${file.extractedText}`;
          if (file.isImage) content.push({ type: 'image_url', image_url: { url: file.data } });
        });
        if (combinedText) content.unshift({ type: 'text', text: combinedText });
        apiMessages.push({ role: 'user', content: content.length > 1 ? content : combinedText });
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    });

    const startTime = Date.now();
    let fullText = '';
    let currentTokenCount = 0;

    try {
      abortControllerRef.current = new AbortController();
      const res = await fetch(`${CONFIG.host}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.apiKey}`,
          'ngrok-skip-browser-warning': 'true'
        },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({ model: CONFIG.model, messages: apiMessages, stream: true })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamingMessage = { 
        role: 'assistant', 
        content: '', 
        tokens: 0, 
        speed: 0,
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }) 
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine || cleanedLine === 'data: [DONE]') continue;
          if (cleanedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(cleanedLine.slice(6));
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                currentTokenCount++;
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = (currentTokenCount / elapsed).toFixed(1);
                streamingMessage = { ...streamingMessage, content: fullText, tokens: currentTokenCount, speed };
                setSessions(prev => ({ ...prev, [currentSessionName]: [...updatedConversation, streamingMessage] }));
                setTokenSpeed(speed);
              }
            } catch (e) { console.warn(e); }
          }
        }
      }
      setTotalTokens(prev => prev + currentTokenCount);
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errMsg = { role: 'system', content: `Error: ${err.message}`, isError: true };
        setSessions(prev => ({ ...prev, [currentSessionName]: [...updatedConversation, errMsg] }));
      }
    } finally {
      setIsGenerating(false);
      if (textareaRef.current) textareaRef.current.focus();
    }
  };

  const handleSlashCommand = (cmd) => {
    const [action, ...args] = cmd.split(' ');
    const arg = args.join(' ').trim();
    let sysMsg = '';
    switch (action.toLowerCase()) {
      case '/new':
        if (arg) {
          setSessions(prev => ({ ...prev, [arg]: [] }));
          setCurrentSessionName(arg);
          sysMsg = `Switched to new session: ${arg}`;
        }
        break;
      case '/clear':
        clearMessages();
        sysMsg = 'Session cleared.';
        break;
      default: sysMsg = `Unknown command: ${action}`;
    }
    if (sysMsg) {
      setSessions(prev => ({ ...prev, [currentSessionName]: [...prev[currentSessionName], { role: 'system', content: sysMsg }] }));
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
  };

  const renderContent = (content) => {
    const html = marked.parse(content, { gfm: true, breaks: true });
    return { __html: DOMPurify.sanitize(html) };
  };

  const sortedSessions = Object.keys(sessions).reverse();
  const filteredSessions = sortedSessions.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()));

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--error)' }}>
        <h1>Something went wrong</h1>
        <p>{error.message}</p>
        <button onClick={() => window.location.reload()} className="clear-btn">Reload Page</button>
      </div>
    );
  }

  return (
    <div className="root-wrap" style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Camera Overlay */}
      {isCameraOpen && (
        <div className="camera-overlay">
          <video ref={videoRef} autoPlay className="camera-preview" />
          <div className="camera-actions">
            <button className="cam-btn close" onClick={stopCamera}><X /></button>
            <button className="cam-btn" onClick={capturePhoto}><ImageIcon /></button>
          </div>
        </div>
      )}

      <aside className={`sidebar ${!sidebarOpen ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <div className="sidebar-header">
            <button className="new-chat-btn" onClick={startNewChat}>
              <Plus size={16} /> New Chat
            </button>
            <div className="search-wrap">
              <Search className="search-icon" size={12} />
              <input 
                type="text" 
                className="search-input" 
                placeholder="Search chats..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="session-list">
            {filteredSessions.map(name => (
              <div key={name} className={`session-item ${name === currentSessionName ? 'active' : ''}`} onClick={() => resumeSession(name)}>
                <MessageSquare size={14} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {renamingSession === name ? (
                    <input 
                      autoFocus 
                      className="rename-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onBlur={() => handleRename(name)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRename(name)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                  )}
                </div>
                {renamingSession !== name && (
                  <div className="session-actions">
                    <Edit2 
                      size={14} 
                      className="action-btn" 
                      onClick={(e) => { e.stopPropagation(); setRenamingSession(name); setNewName(name); }} 
                      title="Rename"
                    />
                    {name !== 'default' && (
                      <Trash2 
                        size={14} 
                        className="action-btn delete" 
                        onClick={(e) => deleteSession(e, name)} 
                        title="Delete"
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="main-container">
        <header className="topbar">
          <div className="topbar-left">
            <button className="sidebar-toggle" onClick={toggleSidebar}>
              <Menu size={20} />
            </button>
            <div className="logo">
              <div className="logo-icon">Z</div>
              ZyntaxAI
            </div>
            <div className="model-badge">
              ◆ <span>{CONFIG.model}</span>
            </div>
            <button className="clear-btn" onClick={clearMessages}>Clear</button>
          </div>
          <div className="status-bar">
            <button className="clear-btn" onClick={toggleTheme} style={{ fontSize: '16px', padding: '4px 8px' }}>
              {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="status-pill">
              <div className="dot"></div>
              <span>{isGenerating ? 'Generating...' : 'Connected'}</span>
            </div>
            <div className="stat">tokens <span>{totalTokens}</span></div>
            <div className="stat">msgs <span>{Math.ceil(conversation.length / 2)}</span></div>
          </div>
        </header>

        <div className="sys-panel">
          <span className="sys-label">⚡ system</span>
          <input className="sys-input" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="System prompt..." />
        </div>

        <div className="terminal-wrap">
          <div className="messages">
            {conversation.length === 0 ? (
              <div className="welcome">
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>◈</div>
                <h1>How can I help you today?</h1>
                <p>Local AI running <strong style={{ color: 'var(--accent)' }}>{CONFIG.model}</strong>. Secure, private, and fast.</p>
              </div>
            ) : (
              <>
                {conversation.map((msg, i) => (
                  <div key={i} className={`msg-row ${msg.role} ${msg.isError ? 'error-row' : ''} ${msg.role === 'system' ? 'system-msg-row' : ''}`}>
                    {msg.role !== 'system' && (
                      <div className="msg-header">
                        <span className={`msg-role-badge ${msg.role}`}>
                          {msg.role === 'user' ? 'YOU' : `◈ ${CONFIG.model}`}
                        </span>
                        <span className="msg-meta">{msg.timestamp}</span>
                        {msg.tokens && <span className="msg-tokens">{msg.tokens} tokens · {msg.speed} tok/s</span>}
                      </div>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="msg-attachments">
                        {msg.attachments.map((file, idx) => (
                          file.isImage ? (
                            <img key={idx} src={file.data} alt="attachment" className="msg-attachment-img" />
                          ) : (
                            <div key={idx} className="msg-attachment-file">
                              <Paperclip size={14} /> <span>{file.name}</span>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                    <div className={msg.role === 'system' ? 'system-msg-body' : 'msg-body'} dangerouslySetInnerHTML={msg.role === 'system' ? { __html: msg.content } : renderContent(msg.content)} />
                  </div>
                ))}
                {isGenerating && conversation[conversation.length - 1]?.role === 'user' && (
                  <div className="typing-row">
                    <span className="msg-role-badge assistant" style={{ fontSize: '9px', padding: '2px 7px' }}>AI</span>
                    <span className="typing-label">thinking</span>
                    <div className="typing-dots"><span></span><span></span><span></span></div>
                  </div>
                )}
                {isProcessingFile && (
                  <div className="system-msg-row">
                    <div className="system-msg-body" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="typing-dots" style={{ opacity: 1 }}><span style={{ background: 'var(--accent)' }}></span></div>
                      <span>Extracting text and processing files...</span>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            {attachedFiles.length > 0 && (
              <div className="attachment-previews">
                {attachedFiles.map((file, idx) => (
                  <div key={idx} className="attachment-preview">
                    {file.isImage ? <img src={file.data} alt="preview" /> : <div className="file-icon-preview"><Paperclip size={16} /></div>}
                    <button className="remove-attachment" onClick={() => removeAttachment(idx)}><X size={10} /></button>
                    <span className="file-name-tooltip">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="input-row">
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileSelect} />
              <button className="upload-btn" onClick={() => fileInputRef.current?.click()} title="Upload files"><Paperclip size={18} /></button>
              <button className="upload-btn" onClick={startCamera} title="Take photo"><Camera size={18} /></button>
              <textarea ref={textareaRef} placeholder="Type a message... (Shift+Enter for newline)" rows="1" value={userInput} onChange={(e) => { setUserInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={handleKeyDown} autoFocus />
              <div className="input-actions">
                <div className="key-hint">Enter to send<br />Shift+↵ newline</div>
                <button className="send-btn" onClick={handleSendMessage} title={isGenerating ? "Stop" : "Send"}>
                  {isGenerating ? <Square size={16} fill="var(--error)" color="var(--error)" /> : <Send size={16} fill="#000" />}
                </button>
              </div>
            </div>
            <div className="bottom-meta">
              <span className="bottom-hint">{CONFIG.host.replace('https://', '')}</span>
              <div className="bottom-stats">
                <span className="bstat">session <span>{formatTime(sessionTime)}</span></span>
                <span className="bstat">speed <span>{tokenSpeed || '—'}</span> tok/s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
