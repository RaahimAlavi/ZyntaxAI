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
  Image as ImageIcon
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './App.css';

// --- Constants & Config ---
const CONFIG = {
  host: 'https://congressional-eve-hoppingly.ngrok-free.dev',
  model: 'qwen3',
  apiKey: 'sk-raahim-secret-key'
};

function App() {
  // --- State ---
  const [sessions, setSessions] = useState(() => {
    const saved = localStorage.getItem('zyntax_sessions');
    return saved ? JSON.parse(saved) : { default: [] };
  });
  const [currentSessionName, setCurrentSessionName] = useState(() => {
    return localStorage.getItem('zyntax_current_session') || 'default';
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('zyntax_theme') || 'dark';
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [userInput, setUserInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]); // [{ name, data, type, isImage }]
  const [isGenerating, setIsGenerating] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [tokenSpeed, setTokenSpeed] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant running locally via Ollama. Be concise, accurate, and technical when needed.');
  
  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
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
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    const processedFiles = await Promise.all(files.map(async file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            name: file.name,
            data: e.target.result, // base64 string
            type: file.type,
            isImage: file.type.startsWith('image/')
          });
        };
        reader.readAsDataURL(file);
      });
    }));
    setAttachedFiles(prev => [...prev, ...processedFiles]);
    e.target.value = ''; // Reset input
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
  };

  const resumeSession = (name) => {
    setCurrentSessionName(name);
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

    // Command handling
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

    // Format for OpenAI Vision API if there are images
    const apiMessages = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }]
      : [];

    updatedConversation.forEach(msg => {
      if (msg.role === 'system') return;
      
      if (msg.role === 'user') {
        const content = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        
        msg.attachments?.forEach(file => {
          if (file.isImage) {
            content.push({ 
              type: 'image_url', 
              image_url: { url: file.data } 
            });
          } else {
            content.push({ type: 'text', text: `[Attached File: ${file.name}]` });
          }
        });
        
        apiMessages.push({ role: 'user', content: content.length > 1 ? content : msg.content });
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
        body: JSON.stringify({
          model: CONFIG.model,
          messages: apiMessages,
          stream: true
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Temporary state for the streaming message
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
                
                // Real-time update
                setSessions(prev => ({
                  ...prev,
                  [currentSessionName]: [...updatedConversation, streamingMessage]
                }));
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
      // Add other commands as needed
      default:
        sysMsg = `Unknown command: ${action}`;
    }

    if (sysMsg) {
      setSessions(prev => ({
        ...prev,
        [currentSessionName]: [...prev[currentSessionName], { role: 'system', content: sysMsg }]
      }));
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // --- Render Helpers ---
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

  return (
    <div className="root-wrap" style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Sidebar */}
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
              <div 
                key={name}
                className={`session-item ${name === currentSessionName ? 'active' : ''}`}
                onClick={() => resumeSession(name)}
              >
                <MessageSquare size={14} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                {name !== 'default' && (
                  <Trash2 
                    className="delete-btn" 
                    size={14} 
                    onClick={(e) => deleteSession(e, name)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-container">
        {/* Topbar */}
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
              <div className={`dot ${!CONFIG.host ? 'offline' : ''}`}></div>
              <span>{isGenerating ? 'Generating...' : 'Connected'}</span>
            </div>
            <div className="stat">tokens <span>{totalTokens}</span></div>
            <div className="stat">msgs <span>{Math.ceil(conversation.length / 2)}</span></div>
          </div>
        </header>

        {/* System Bar */}
        <div className="sys-panel">
          <span className="sys-label">⚡ system</span>
          <input 
            className="sys-input" 
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="System prompt..."
          />
        </div>

        {/* Messages */}
        <div className="terminal-wrap">
          <div className="messages">
            {conversation.length === 0 ? (
              <div className="welcome">
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>◈</div>
                <h1>How can I help you today?</h1>
                <p>Local AI running <strong style={{ color: 'var(--accent)' }}>{CONFIG.model}</strong>. Secure, private, and fast.</p>
              </div>
            ) : (
              conversation.map((msg, i) => (
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
                  <div 
                    className={msg.role === 'system' ? 'system-msg-body' : 'msg-body'}
                    dangerouslySetInnerHTML={msg.role === 'system' ? { __html: msg.content } : renderContent(msg.content)}
                  />
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="input-area">
            {attachedFiles.length > 0 && (
              <div className="attachment-previews">
                {attachedFiles.map((file, idx) => (
                  <div key={idx} className="attachment-preview">
                    {file.isImage ? (
                      <img src={file.data} alt="preview" />
                    ) : (
                      <div className="file-icon-preview"><Paperclip size={16} /></div>
                    )}
                    <button className="remove-attachment" onClick={() => removeAttachment(idx)}>
                      <X size={10} />
                    </button>
                    <span className="file-name-tooltip">{file.name}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="input-row">
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                multiple 
                onChange={handleFileSelect}
              />
              <button 
                className="upload-btn" 
                onClick={() => fileInputRef.current?.click()}
                title="Upload files"
              >
                <Paperclip size={18} />
              </button>
              <textarea 
                ref={textareaRef}
                placeholder="Type a message... (Shift+Enter for newline)" 
                rows="1" 
                value={userInput}
                onChange={(e) => {
                  setUserInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <div className="input-actions">
                <div className="key-hint">Enter to send<br />Shift+↵ newline</div>
                <button className="send-btn" onClick={handleSendMessage} title={isGenerating ? "Stop" : "Send"}>
                  {isGenerating ? (
                    <Square size={16} fill="var(--error)" color="var(--error)" />
                  ) : (
                    <Send size={16} fill="#000" />
                  )}
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
