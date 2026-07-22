/* ==========================================================================
   RTO Digital Assistant - Interactive Client Logic & Accessibility
   ========================================================================== */

// Allow dynamic custom backend URL override (e.g., via ?backend=... query parameter or localStorage)
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const backendParam = urlParams.get('backend');
    if (backendParam) {
        localStorage.setItem('rto-custom-backend-url', backendParam.replace(/\/$/, ''));
    }
})();

const API_BASE_URL = (function() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }
    // Only use localtunnel backend if frontend itself is served from localtunnel (.loca.lt)
    if (window.location.hostname.endsWith('.loca.lt') && window.RTO_TUNNEL_BACKEND) {
        return window.RTO_TUNNEL_BACKEND;
    }
    const customBackend = localStorage.getItem('rto-custom-backend-url');
    if (customBackend) {
        return customBackend;
    }
    return 'https://rto-assistant-backend.onrender.com';
})();

// Global State
let currentLanguage = 'en';
let currentTone = 'detailed'; // quick, friendly, detailed
let isInitialized = false; // Flag to track DOMContentLoaded initialization state
let currentFontSize = 'md'; // sm, md, lg, xl
let activeTheme = 'light'; // light, dark, contrast
let isListening = false;
let voiceTimeout = null;
let userHasManuallySetTheme = false;
let shouldSpeakReply = false; // Flag to speak the next assistant reply automatically

// Audio capture & native playback states for Gemini Live integration
let mediaRecorder = null;
let audioChunks = [];
let activeAudioCtx = null;
let activeAudioSource = null;
const audioCache = {}; // Cache generated TTS audio to prevent redundant network calls
const conversationHistory = JSON.parse(sessionStorage.getItem('rto-chat-history') || '[]'); // In-memory session history for context retention
let activeTTSController = null; // AbortController to cancel pending fetches
let activeSpeakButton = null; // Track currently playing message button
let activeUtterance = null; // Prevent browser garbage collection bugs by storing reference
let speechWatchdog = null; // Safety timer to resolve audio deadlocks

// Initialize Web Speech API for voice dictation
let recognition = null;
let finalSpeechText = ''; // Track transcribed speech text across events
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true; // Enable intermediate results for real-time visual updates
}

// Audio context variables for microphone input visualizer
let audioContext = null;
let audioSource = null;
let analyser = null;
let audioStream = null;
let visualizerFrameId = null;

// State tracking variables for API requests
let isGenerating = false;
let activeChatController = null;
let currentChatId = null; // Tracks active IndexedDB chat session ID

// --------------------------------------------------------------------------
// IndexedDB Wrapper class to handle large persistent database storage offline
// --------------------------------------------------------------------------
const DB_NAME = 'RTODigitalAssistantDB';
const DB_VERSION = 1;

class RTOChatDB {
    static open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('chats')) {
                    db.createObjectStore('chats', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('messages')) {
                    const messageStore = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    messageStore.createIndex('chat_id', 'chat_id', { unique: false });
                }
            };
        });
    }

    static async saveChat(chat) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('chats', 'readwrite');
            const store = transaction.objectStore('chats');
            const request = store.put(chat);
            request.onsuccess = () => resolve(request.result); // Returns newly generated ID
            request.onerror = () => reject(request.error);
        });
    }

    static async getChats() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('chats', 'readonly');
            const store = transaction.objectStore('chats');
            const request = store.getAll();
            request.onsuccess = () => {
                // Sort chats to show newest first (using ID descending)
                const chats = request.result.sort((a, b) => b.id - a.id);
                resolve(chats);
            };
            request.onerror = () => reject(request.error);
        });
    }

    static async deleteChat(chatId) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['chats', 'messages'], 'readwrite');
            
            // Delete the chat head
            transaction.objectStore('chats').delete(chatId);
            
            // Delete all messages associated with this chat ID
            const messageStore = transaction.objectStore('messages');
            const index = messageStore.index('chat_id');
            const request = index.openCursor(IDBKeyRange.only(chatId));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    static async saveMessage(message) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('messages', 'readwrite');
            const store = transaction.objectStore('messages');
            const request = store.add(message);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    static async getMessages(chatId) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('messages', 'readonly');
            const store = transaction.objectStore('messages');
            const index = store.index('chat_id');
            const request = index.getAll(IDBKeyRange.only(chatId));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Bilingual UI Text Map
const uiStrings = {
    en: {
        welcome: "Namaste! Welcome to the RTO Digital Assistant. I am designed to help citizens of Uttarakhand find RTO information easily.<br><br>Feel free to ask me anything about <strong>Driving Licenses</strong>, <strong>Vehicle RC</strong>, or <strong>Challans</strong>.",
        placeholder: "Type your message here...",
        waitingPlaceholder: "Waiting for response...",
        btnSpeak: "Speak",
        listening: "Listening...",
        transcribing: "Transcribing...",
        defaultReply: "I will be ready soon...",
        voiceResult: "How to check driving license status?",
        workingHours: "Working Hours: 10:00 AM - 5:00 PM (Mon-Sat)",
        senderAssistant: "RTO Sahayak",
        senderUser: "You"
    },
    hi: {
        welcome: "नमस्ते! आरटीओ डिजिटल असिस्टेंट (RTO Assistant) में आपका स्वागत है। मुझे उत्तराखंड के लोगों को आरटीओ से जुड़ी जानकारी आसानी से देने के लिए बनाया गया है।<br><br>आप मुझसे <strong>ड्राइविंग लाइसेंस (DL)</strong>, <strong>गाड़ी की RC</strong>, या <strong>चालान</strong> के बारे में कुछ भी पूछ सकते हैं।",
        placeholder: "अपना सवाल यहाँ लिखें...",
        waitingPlaceholder: "जवाब का इंतज़ार करें...",
        btnSpeak: "बोलें",
        listening: "सुन रहा हूँ...",
        transcribing: "लिख रहा हूँ...",
        defaultReply: "मैं बस तैयार हो रहा हूँ...",
        voiceResult: "ड्राइविंग लाइसेंस का स्टेटस कैसे चेक करें?",
        workingHours: "काम का समय: सुबह 10:00 से शाम 5:00 (सोमवार से शनिवार)",
        senderAssistant: "आरटीओ सहायक",
        senderUser: "आप"
    },
    hn: {
        welcome: "Namaste! RTO Digital Assistant me aapka welcome hai. Main Uttarakhand ke logo ki help ke liye design kiya gaya hu.<br><br>Aap mujhse <strong>Driving License</strong>, <strong>Vehicle RC</strong>, ya <strong>Challan</strong> ke baare me kuch bhi pooch sakte hai.",
        placeholder: "Apna message yahan type kare...",
        waitingPlaceholder: "Response ka wait kare...",
        btnSpeak: "Bole",
        listening: "Sun raha hu...",
        transcribing: "Type ho raha hai...",
        defaultReply: "Main jaldi hi ready ho jaunga...",
        voiceResult: "Driving license status kaise check kare?",
        workingHours: "Working Hours: 10:00 AM - 5:00 PM (Mon-Sat)",
        senderAssistant: "RTO Sahayak",
        senderUser: "Aap"
    }
};

// --------------------------------------------------------------------------
// Sidebar Drawer Toggle (Mobile View)
// --------------------------------------------------------------------------

function toggleSidebar(open) {
    const sidebar = document.getElementById('info-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;

    if (open) {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Stop body scrolling under drawer
    } else {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Manage dynamic collapse (PC/Desktop) vs drawer slide (Mobile) on menu click
function handleMenuToggle() {
    if (window.innerWidth <= 900) {
        const sidebar = document.getElementById('info-sidebar');
        if (sidebar) {
            const isOpen = sidebar.classList.contains('open');
            toggleSidebar(!isOpen); // Toggle open/close on mobile
        }
    } else {
        const mainContainer = document.getElementById('chat-container');
        if (!mainContainer) return;
        const isCollapsed = mainContainer.classList.toggle('sidebar-collapsed');
        localStorage.setItem('rto-desktop-sidebar-state', isCollapsed ? 'collapsed' : 'expanded');
    }
}

// --------------------------------------------------------------------------
// Touch Swipe Gestures for Mobile Sidebar Drawer (Continuous Interactive Swipe with Direction Lock)
// --------------------------------------------------------------------------
let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let touchCurrentY = 0;
let isDraggingSidebar = false;
let hasResolvedTouchDirection = false;
let sidebarStartLeft = 0;

document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCurrentX = touchStartX;
    touchCurrentY = touchStartY;
    
    // Reset state for new gesture interaction
    isDraggingSidebar = false;
    hasResolvedTouchDirection = false;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const diffX = e.touches[0].clientX - touchStartX;
    const diffY = e.touches[0].clientY - touchStartY;

    if (!hasResolvedTouchDirection) {
        // Wait for a small physical displacement (8px) to filter intent
        if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
            hasResolvedTouchDirection = true;
            
            const sidebar = document.getElementById('info-sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            const isOpen = sidebar ? sidebar.classList.contains('open') : false;
            
            // If movement is primarily horizontal, lock scroll and start dragging
            if (Math.abs(diffX) > Math.abs(diffY) * 0.8) {
                // If sidebar is closed and swiping left, ignore
                if (!isOpen && diffX < 0) {
                    isDraggingSidebar = false;
                } else {
                    isDraggingSidebar = true;
                    sidebarStartLeft = isOpen ? 0 : -window.innerWidth;
                    if (sidebar && overlay) {
                        sidebar.style.transition = 'none';
                        overlay.style.transition = 'none';
                        overlay.style.display = 'block';
                    }
                }
            } else {
                // Vertical scrolling: do not drag sidebar
                isDraggingSidebar = false;
            }
        }
    }
    
    if (isDraggingSidebar) {
        // Prevent background vertical page scrolling only when actively dragging sidebar
        e.preventDefault();
        handleTouchMove(e);
    }
}, { passive: false });

document.addEventListener('touchend', (e) => {
    if (!isDraggingSidebar) return;
    isDraggingSidebar = false;
    
    const sidebar = document.getElementById('info-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    
    // Restore transition styles
    sidebar.style.transition = '';
    overlay.style.transition = '';
    
    const endX = e.changedTouches[0].clientX;
    const diffX = endX - touchStartX;
    const isCurrentlyOpen = sidebar.classList.contains('open');
    const screenWidth = window.innerWidth;
    
    // Decide whether to open or close based on drag distance or swipe speed
    let shouldOpen = false;
    if (isCurrentlyOpen) {
        shouldOpen = (diffX > -screenWidth * 0.25);
    } else {
        shouldOpen = (diffX > screenWidth * 0.25);
    }
    
    // Clear inline styles so class-based CSS properties take back control cleanly
    sidebar.style.left = '';
    overlay.style.opacity = '';
    overlay.style.display = '';
    
    toggleSidebar(shouldOpen);
}, { passive: true });

function handleTouchMove(e) {
    if (!isDraggingSidebar) return;
    
    touchCurrentX = e.touches[0].clientX;
    touchCurrentY = e.touches[0].clientY;
    
    const diffX = touchCurrentX - touchStartX;
    
    const sidebar = document.getElementById('info-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    
    // Calculate new left position
    let newLeft = sidebarStartLeft + diffX;
    
    // Constrain newLeft between -window.innerWidth (hidden) and 0 (fully open)
    newLeft = Math.min(0, Math.max(-window.innerWidth, newLeft));
    
    sidebar.style.left = newLeft + 'px';
    
    // Calculate progress percentage (0 to 1)
    const progress = (newLeft + window.innerWidth) / window.innerWidth;
    
    // Update overlay opacity dynamically (up to 1.0 opacity)
    overlay.style.opacity = progress;
}

function cancelSidebarDrag() {
    isDraggingSidebar = false;
    const sidebar = document.getElementById('info-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.style.transition = '';
        overlay.style.transition = '';
        sidebar.style.left = '';
        overlay.style.opacity = '';
        overlay.style.display = '';
        
        // Re-align to its current class state
        const isOpen = sidebar.classList.contains('open');
        toggleSidebar(isOpen);
    }
}

// --------------------------------------------------------------------------
// Accessibility: Text Resizing & Themes
// --------------------------------------------------------------------------

function adjustTextSize(action) {
    const body = document.body;
    
    // Remove all text size classes
    body.classList.remove('text-sm', 'text-md', 'text-lg', 'text-xl');
    
    // Determine next size
    if (action === 'up') {
        if (currentFontSize === 'sm') currentFontSize = 'md';
        else if (currentFontSize === 'md') currentFontSize = 'lg';
        else if (currentFontSize === 'lg') currentFontSize = 'xl';
    } else if (action === 'down') {
        if (currentFontSize === 'xl') currentFontSize = 'lg';
        else if (currentFontSize === 'lg') currentFontSize = 'md';
        else if (currentFontSize === 'md') currentFontSize = 'sm';
    } else if (action === 'sm' || action === 'md' || action === 'lg' || action === 'xl') {
        currentFontSize = action; // Force saved size from localStorage
    } else {
        currentFontSize = 'md'; // reset
    }
    
    // Add current class
    body.classList.add(`text-${currentFontSize}`);
    
    // Update active button state
    document.getElementById('font-decrease').classList.remove('active');
    document.getElementById('font-reset').classList.remove('active');
    document.getElementById('font-increase').classList.remove('active');
    
    if (currentFontSize === 'sm') document.getElementById('font-decrease').classList.add('active');
    if (currentFontSize === 'md') document.getElementById('font-reset').classList.add('active');
    if (currentFontSize === 'lg' || currentFontSize === 'xl') document.getElementById('font-increase').classList.add('active');

    // Save user size to localStorage
    localStorage.setItem('rto-user-font-size', currentFontSize);
}

function setTheme(themeName, isManual = true) {
    if (isManual) {
        // Save user override to localStorage
        localStorage.setItem('rto-user-theme', themeName);
    }

    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark', 'theme-contrast');
    
    let resolvedTheme = themeName;
    if (themeName === 'system') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolvedTheme = prefersDark ? 'dark' : 'light';
    }
    
    body.classList.add(`theme-${resolvedTheme}`);
    activeTheme = themeName;
    
    // Update button states
    document.getElementById('theme-system').classList.remove('active');
    document.getElementById('theme-light').classList.remove('active');
    document.getElementById('theme-dark').classList.remove('active');
    document.getElementById('theme-contrast').classList.remove('active');
    
    document.getElementById(`theme-${themeName}`).classList.add('active');
}

// --------------------------------------------------------------------------
// Accessibility: Language Toggles (English / Hindi)
// --------------------------------------------------------------------------

function setLanguage(lang) {
    currentLanguage = lang;
    
    // Save language to localStorage
    localStorage.setItem('rto-user-lang', lang);
    
    // Update toggle button states
    document.getElementById('lang-en').classList.remove('active');
    document.getElementById('lang-hi').classList.remove('active');
    document.getElementById('lang-hn').classList.remove('active');
    document.getElementById('lang-en').setAttribute('aria-pressed', 'false');
    document.getElementById('lang-hi').setAttribute('aria-pressed', 'false');
    document.getElementById('lang-hn').setAttribute('aria-pressed', 'false');
    
    document.getElementById(`lang-${lang}`).classList.add('active');
    document.getElementById(`lang-${lang}`).setAttribute('aria-pressed', 'true');
    
    // Translate standard UI text blocks
    document.getElementById('chat-query').placeholder = uiStrings[lang].placeholder;
    
    // Translate working hours in sidebar
    const workingHoursElement = document.querySelector('.working-hours');
    if (workingHoursElement) {
        workingHoursElement.textContent = uiStrings[lang].workingHours;
    }
    
    // Translate elements with language data-attributes (covers welcome title, subtitle, cards & new-chat)
    document.querySelectorAll('[data-en], [data-hi], [data-hn]').forEach(elem => {
        const text = elem.getAttribute(`data-${lang}`);
        if (text) {
            elem.textContent = text;
        }
    });
}

// --------------------------------------------------------------------------
// Accessibility: Tone Toggles (Quick / Friendly / Detailed)
// --------------------------------------------------------------------------

function setTone(tone) {
    currentTone = tone;
    
    // Save tone to localStorage
    localStorage.setItem('rto-user-tone', tone);
    
    // Update toggle button states
    document.getElementById('tone-quick').classList.remove('active');
    document.getElementById('tone-friendly').classList.remove('active');
    document.getElementById('tone-detailed').classList.remove('active');
    document.getElementById('tone-quick').setAttribute('aria-pressed', 'false');
    document.getElementById('tone-friendly').setAttribute('aria-pressed', 'false');
    document.getElementById('tone-detailed').setAttribute('aria-pressed', 'false');
    
    document.getElementById(`tone-${tone}`).classList.add('active');
    document.getElementById(`tone-${tone}`).setAttribute('aria-pressed', 'true');
    
    console.log(`[Dashboard] Response tone changed to: ${tone}`);
}
window.setTone = setTone;

// --------------------------------------------------------------------------
// Accessibility: Text-to-Speech (Audio assistance)
// --------------------------------------------------------------------------

// Helper to decode base64 compressed audio (MP3, WAV, etc.) into Web Audio API buffer and play
function playDecodedAudio(base64Data, onEndedCallback) {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContextClass();
    
    const source = audioCtx.createBufferSource();
    activeAudioSource = source;
    activeAudioCtx = audioCtx;
    
    audioCtx.decodeAudioData(bytes.buffer.slice(0), (audioBuffer) => {
        // Check if user cancelled playback during decode wait
        if (activeAudioSource !== source) {
            audioCtx.close();
            return;
        }
        
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start(0);
        
        source.onended = () => {
            if (activeAudioSource === source) {
                activeAudioSource = null;
                activeAudioCtx = null;
                audioCtx.close();
                if (onEndedCallback) onEndedCallback();
            }
        };
    }, (err) => {
        console.error("Failed to decode audio data:", err);
        if (onEndedCallback) onEndedCallback();
    });
}

// Helper to play raw 16-bit PCM audio (used for Gemini TTS output which returns uncompressed PCM)
function playPCMAudio(base64Data, onEndedCallback, sampleRate = 24000) {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    const int16Array = new Int16Array(bytes.buffer);

    // Trim trailing silence
    let lastActiveSample = int16Array.length - 1;
    while (lastActiveSample > 0 && Math.abs(int16Array[lastActiveSample]) < 300) lastActiveSample--;
    const padding = Math.ceil(sampleRate * 0.1);
    const trimmedArray = int16Array.subarray(0, Math.min(int16Array.length, lastActiveSample + padding));

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContextClass({ sampleRate });
    const audioBuffer = audioCtx.createBuffer(1, trimmedArray.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < trimmedArray.length; i++) channelData[i] = trimmedArray[i] / 32768.0;

    const source = audioCtx.createBufferSource();
    activeAudioSource = source;
    activeAudioCtx = audioCtx;
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
    source.onended = () => {
        if (activeAudioSource === source) {
            activeAudioSource = null;
            activeAudioCtx = null;
            audioCtx.close();
            if (onEndedCallback) onEndedCallback();
        }
    };
}

// Fallback to local SpeechSynthesis if the backend TTS fails
function fallbackSpeechSynthesis(textToSpeakFinal, btnElement) {
    // Cancel any stuck browser speech first to release internal deadlocks
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    
    const utterance = new SpeechSynthesisUtterance(textToSpeakFinal);
    const containsHindiScript = /[\u0900-\u097F]/.test(textToSpeakFinal);
    
    if (containsHindiScript) {
        utterance.lang = 'hi-IN';
    } else if (currentLanguage === 'hn') {
        utterance.lang = 'en-IN';
    } else if (currentLanguage === 'hi') {
        utterance.lang = 'hi-IN';
    } else {
        utterance.lang = 'en-US';
    }
    
    const voices = window.speechSynthesis.getVoices();
    let matchedVoice = null;
    
    if (containsHindiScript || currentLanguage === 'hi') {
        matchedVoice = voices.find(v => v.lang.includes('hi-IN') || v.lang.startsWith('hi'));
        if (!matchedVoice) {
            matchedVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.startsWith('en-IN'));
        }
    } else if (currentLanguage === 'hn') {
        matchedVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.startsWith('en-IN'));
        if (!matchedVoice) {
            matchedVoice = voices.find(v => v.lang.includes('hi-IN') || v.lang.startsWith('hi'));
        }
    }
    
    if (!matchedVoice) {
        matchedVoice = voices.find(v => v.lang.includes('en-US') || v.lang.includes('en') || v.lang.startsWith('en'));
    }
    
    if (matchedVoice) utterance.voice = matchedVoice;
    utterance.rate = 0.85;
    
    // Log details of the fallback voice selection to developer console
    console.warn(`⚠️ TTS Fallback: Using browser local SpeechSynthesis voice: "${matchedVoice ? matchedVoice.name : 'System Default'}" (${utterance.lang})`);
    
    btnElement.innerHTML = '<i class="fa-solid fa-circle-stop" style="color: #ef4444;"></i> Stop';
    
    // Hold a global list reference to prevent Chrome's garbage collector from destroying it mid-speech
    window.activeUtterances = window.activeUtterances || [];
    window.activeUtterances.push(utterance);
    activeUtterance = utterance;
    
    // Set up a responsive watchdog timer: (words / 3.0 WPM) * 1.25 safety + 2s base
    const words = textToSpeakFinal.split(/\s+/).length;
    const estimatedDuration = Math.ceil((words / 3.0) * 1000 * 1.25) + 2000;
    
    if (speechWatchdog) clearTimeout(speechWatchdog);
    speechWatchdog = setTimeout(() => {
        console.warn("SpeechSynthesis watchdog fired. Unlocking stuck browser speech engine...");
        stopAllPlayback();
    }, estimatedDuration);
    
    utterance.onended = () => {
        window.activeUtterances = (window.activeUtterances || []).filter(u => u !== utterance);
        if (speechWatchdog) {
            clearTimeout(speechWatchdog);
            speechWatchdog = null;
        }
        activeUtterance = null;
        resetSpeakButtons();
    };
    utterance.onerror = () => {
        window.activeUtterances = (window.activeUtterances || []).filter(u => u !== utterance);
        if (speechWatchdog) {
            clearTimeout(speechWatchdog);
            speechWatchdog = null;
        }
        activeUtterance = null;
        resetSpeakButtons();
    };
    
    // A tiny timeout delay prevents deadlocks when canceling and starting speech immediately in Chrome
    setTimeout(() => {
        window.speechSynthesis.speak(utterance);
    }, 50);
}

function stopAllPlayback() {
    // 0. Clear safety watchdog timer
    if (speechWatchdog) {
        clearTimeout(speechWatchdog);
        speechWatchdog = null;
    }
    
    // 1. Stop native audio source
    if (activeAudioSource) {
        try { activeAudioSource.stop(); } catch (e) {}
        activeAudioSource = null;
    }
    if (activeAudioCtx) {
        try { activeAudioCtx.close(); } catch (e) {}
        activeAudioCtx = null;
    }
    // 2. Stop local SpeechSynthesis
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    activeUtterance = null; // Clear global reference
    
    // 3. Abort any pending TTS fetches
    if (activeTTSController) {
        activeTTSController.abort();
        activeTTSController = null;
    }
    
    resetSpeakButtons();
}

async function speakMessage(btnElement) {
    // Find text inside the message wrapper
    const messageWrapper = btnElement.closest('.message-wrapper');
    const textElement = messageWrapper.querySelector('.message-text');
    const textToSpeak = textElement.textContent || textElement.innerText;
    
    const isCurrentlyPlayingThis = (activeSpeakButton === btnElement);
    
    // Toggle speaking state
    // Check if active audio, local TTS, or loading fetch is running
    if (activeAudioSource || (window.speechSynthesis && window.speechSynthesis.speaking) || activeTTSController) {
        stopAllPlayback();
        
        // If they clicked the same button to toggle off, return
        if (isCurrentlyPlayingThis) {
            return;
        }
    }
    
    // Clean text from emojis
    const cleanedText = textToSpeak.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
    const textToSpeakFinal = cleanedText || textToSpeak;
    
    // Mark this button as active
    activeSpeakButton = btnElement;
    
    // Check local session cache to skip unnecessary API requests
    if (audioCache[textToSpeakFinal]) {
        console.log("Playing speech from session cache...");
        try {
            const cached = audioCache[textToSpeakFinal];
            btnElement.innerHTML = '<i class="fa-solid fa-circle-stop" style="color: #ef4444;"></i> Stop';
            if (cached.format === 'pcm') {
                playPCMAudio(cached.audio, resetSpeakButtons);
            } else {
                playDecodedAudio(cached.audio, resetSpeakButtons);
            }
            return;
        } catch (err) {
            console.warn("Failed to play cached audio, requesting new clip...", err);
        }
    }
    
    try {
        btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Stop'; // Show spinner as STOP indicator so they can abort it
        
        activeTTSController = new AbortController();
        const signal = activeTTSController.signal;
        
        const response = await fetch(`${API_BASE_URL}/api/speak`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: textToSpeakFinal, lang: currentLanguage }),
            signal: signal
        });
        
        activeTTSController = null;
        
        if (response.ok) {
            const data = await response.json();
            
            if (activeSpeakButton !== btnElement) return; // User cancelled during load
            
            const engineName = data.engine || 'unknown';
            console.log(`🔊 TTS Success: engine="${engineName}"`);
            
            // Gemini returns raw 16-bit PCM; gTTS returns compressed MP3
            if (data.format === 'pcm') {
                // Save to cache and play PCM audio
                audioCache[textToSpeakFinal] = { audio: data.audio, format: 'pcm' };
                playPCMAudio(data.audio, resetSpeakButtons);
            } else {
                // Save to cache and play decoded compressed audio (MP3 etc.)
                audioCache[textToSpeakFinal] = { audio: data.audio, format: data.format };
                playDecodedAudio(data.audio, resetSpeakButtons);
            }
            btnElement.innerHTML = '<i class="fa-solid fa-circle-stop" style="color: #ef4444;"></i> Stop';

        } else if (response.status === 503) {
            // Tier 3 signal: backend exhausted all cloud options, use browser TTS
            const errData = await response.json().catch(() => ({}));
            console.warn(`⚠️ TTS Tier 3: Both Gemini and gTTS failed. Using browser Web Speech API.`);
            fallbackSpeechSynthesis(textToSpeakFinal, btnElement);
        } else {
            const errData = await response.json().catch(() => ({}));
            console.warn(`⚠️ TTS backend error (${response.status}): ${errData.error || 'Unknown'}. Using browser Web Speech API.`);
            fallbackSpeechSynthesis(textToSpeakFinal, btnElement);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log("TTS loading fetch aborted by user.");
            resetSpeakButtons();
            return;
        }
        activeTTSController = null;
        console.warn("TTS backend unreachable, falling back to browser speech synthesis:", err);
        fallbackSpeechSynthesis(textToSpeakFinal, btnElement);
    }
}

function resetSpeakButtons() {
    activeSpeakButton = null;
    document.querySelectorAll('.btn-speak').forEach(btn => {
        btn.innerHTML = `<i class="fa-solid fa-volume-high"></i> ${uiStrings[currentLanguage].btnSpeak}`;
    });
}

// Ensure voices are pre-loaded on startup (essential for mobile/Chrome web engines)
if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.getVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            speechSynthesis.getVoices();
        };
    }
}

// --------------------------------------------------------------------------
// Real-Time Web Audio Visualizer (3 Thicker Waves)
// --------------------------------------------------------------------------

async function startAudioVisualization(existingStream) {
    try {
        const bar1 = document.getElementById('wave-bar-1');
        const bar2 = document.getElementById('wave-bar-2');
        const bar3 = document.getElementById('wave-bar-3');

        audioStream = existingStream;
        
        // Create Audio Context
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
        
        // Resume AudioContext if suspended (browser security autostart block)
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 32; // Small size for 3 frequency channels
        
        audioSource = audioContext.createMediaStreamSource(audioStream);
        audioSource.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Remove fallback CSS animations
        if (bar1 && bar2 && bar3) {
            bar1.classList.remove('animated');
            bar2.classList.remove('animated');
            bar3.classList.remove('animated');
        }
        
        function draw() {
            if (!isListening) return;
            
            visualizerFrameId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);
            
            // Low, mid, and high frequencies mapping
            const val1 = dataArray[1] || 0;
            const val2 = dataArray[3] || 0;
            const val3 = dataArray[5] || 0;
            
            // Map intensity (0-255) to height (4px to 30px)
            const minH = 4;
            const maxH = 30;
            
            // Symmetrical mapping: Center bar (bar2) gets vocal fundamentals (val1 - highest energy)
            // Left bar (bar1) gets mid-frequencies (val2 - medium energy)
            // Right bar (bar3) gets high-frequencies (val3 - lowest energy)
            const h_left   = minH + (val2 / 255) * (maxH - minH);
            const h_center = minH + (val1 / 255) * (maxH - minH);
            const h_right  = minH + (val3 / 255) * (maxH - minH);
            
            if (bar1) bar1.style.height = `${h_left}px`;
            if (bar2) bar2.style.height = `${h_center}px`;
            if (bar3) bar3.style.height = `${h_right}px`;
        }
        
        draw();
    } catch (err) {
        console.warn("Could not start real-time audio visualizer, falling back to CSS animation:", err);
        restoreFallbackWaveAnimation();
    }
}

function stopAudioVisualization() {
    if (visualizerFrameId) {
        cancelAnimationFrame(visualizerFrameId);
        visualizerFrameId = null;
    }
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    if (audioContext) {
        if (audioContext.state !== 'closed') {
            audioContext.close();
        }
        audioContext = null;
    }
    restoreFallbackWaveAnimation();
}

function restoreFallbackWaveAnimation() {
    const bar1 = document.getElementById('wave-bar-1');
    const bar2 = document.getElementById('wave-bar-2');
    const bar3 = document.getElementById('wave-bar-3');
    if (bar1 && bar2 && bar3) {
        bar1.classList.add('animated');
        bar2.classList.add('animated');
        bar3.classList.add('animated');
        bar1.style.height = '';
        bar2.style.height = '';
        bar3.style.height = '';
    }
}

// --------------------------------------------------------------------------
// Integrated Voice-to-Text Simulation (In-Bar Waves)
// --------------------------------------------------------------------------

async function toggleVoiceInput() {
    const inputField = document.getElementById('chat-query');
    const waveContainer = document.getElementById('voice-waves');
    const indicatorText = document.getElementById('voice-text-indicator');
    const micBtn = document.getElementById('voice-btn');
    const sendBtn = document.getElementById('send-btn');
    
    if (isListening) {
        // Stop Listening
        isListening = false;
        
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) {
                console.error("Failed to stop mediaRecorder:", e);
            }
        }
        
        stopAudioVisualization(); // Re-flattens bars and stops microphone stream tracks
        
        waveContainer.style.display = 'none';
        inputField.style.display = 'block';
        
        micBtn.classList.remove('listening-active');
        sendBtn.removeAttribute('disabled');
    } else {
        // Start Listening
        isListening = true;
        
        inputField.style.display = 'none';
        waveContainer.style.display = 'flex';
        indicatorText.textContent = uiStrings[currentLanguage].listening;
        
        micBtn.classList.add('listening-active');
        sendBtn.setAttribute('disabled', 'true');
        
        try {
            // 1. Instantly request mic stream to capture the first spoken words without delay
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.error("Failed to request mic stream:", e);
            indicatorText.textContent = "Mic blocked. Allow permission in settings.";
            setTimeout(() => { if (isListening) toggleVoiceInput(); }, 3000);
            return;
        }
        
        // 2. Initialize and start MediaRecorder instantly to prevent sound cuts
        let mimeType = 'audio/webm';
        try {
            mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
        } catch (e) {
            // Fallback for Safari/iOS which do not support audio/webm
            try {
                mediaRecorder = new MediaRecorder(audioStream);
            } catch (e2) {
                console.error("MediaRecorder not supported:", e2);
                indicatorText.textContent = "Mic recording not supported.";
                setTimeout(() => { if (isListening) toggleVoiceInput(); }, 3000);
                return;
            }
        }
        
        if (mediaRecorder) {
            audioChunks = [];
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            mediaRecorder.onstop = async () => {
                const resolvedMime = mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunks, { type: resolvedMime });
                
                // Convert audio file blob to Base64
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Data = reader.result.split(',')[1];
                    submitVoiceQuery(base64Data, resolvedMime);
                };
            };
            mediaRecorder.start();
        }
        
        // 3. Start audio visualizer in background (without await block to prevent startup delay)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (!isMobile) {
            startAudioVisualization(audioStream);
        } else {
            restoreFallbackWaveAnimation();
        }
    }
}

async function submitVoiceQuery(base64Audio, mimeType) {
    // 1. Append user message bubble with transcription placeholder
    const chatFeed = document.getElementById('chat-messages');
    const msgElement = document.createElement('div');
    msgElement.className = 'message user';
    msgElement.innerHTML = `
        <div class="avatar" aria-hidden="true"><i class="fa-solid fa-user"></i></div>
        <div class="message-wrapper">
            <div class="message-content">
                <div class="message-text" id="user-voice-transcription-placeholder">
                    <span style="color: var(--text-muted); font-style: italic;">
                        <i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Transcribing voice query...
                    </span>
                </div>
            </div>
        </div>
    `;
    chatFeed.appendChild(msgElement);
    chatFeed.scrollTop = chatFeed.scrollHeight;
    
    // Hide welcome screen if visible
    hideWelcomeScreen();
    
    // 2. Display assistant typing state indicator
    showTypingIndicator();
    
    setGeneratingState(true);
    activeChatController = new AbortController();
    const signal = activeChatController.signal;
    
    // If starting a new session, create it in database
    let isNewSession = false;
    if (currentChatId === null) {
        isNewSession = true;
        try {
            currentChatId = await RTOChatDB.saveChat({
                title: 'New Chat...',
                created_at: Date.now(),
                language: currentLanguage
            });
            sessionStorage.setItem('rto-active-chat-id', currentChatId);
            await loadRecentChatsList();
        } catch (dbErr) {
            console.error("Failed to initialize chat in DB:", dbErr);
        }
    }

    let lastVoiceTranscription = "";
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                audio: base64Audio,
                mime_type: mimeType,
                language: currentLanguage,
                history: conversationHistory,
                tone: currentTone
            }),
            signal: signal
        });
        
        hideTypingIndicator();
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/event-stream')) {
            // 3. Set up the empty streaming bubble in the feed
            const messageWrapper = appendEmptyAssistantBubble();
            const textElement = messageWrapper.querySelector('.message-text');
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullReplyText = "";
            let streamBuffer = "";
            
            // Read and parse streaming chunks
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                streamBuffer += decoder.decode(value, { stream: true });
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || "";
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr) continue;
                            const data = JSON.parse(jsonStr);
                            
                            if (data.user_transcription) {
                                // Update user's text bubble with the transcribed text!
                                const userTextBubble = document.getElementById('user-voice-transcription-placeholder');
                                if (userTextBubble) {
                                    userTextBubble.textContent = data.user_transcription;
                                    userTextBubble.removeAttribute('id'); // Clear placeholder id
                                }
                                addToHistory('user', data.user_transcription);
                                lastVoiceTranscription = data.user_transcription;

                                // Save user message to IndexedDB
                                if (currentChatId !== null) {
                                    await RTOChatDB.saveMessage({
                                        chat_id: currentChatId,
                                        role: 'user',
                                        text: data.user_transcription,
                                        timestamp: Date.now()
                                    });
                                }
                            } else if (data.reply) {
                                fullReplyText += data.reply;
                                // Parse markdown live using Marked.js
                                textElement.innerHTML = renderMarkdown(fullReplyText);
                                
                                // Scroll the chat to follow generation
                                const chatFeed = document.getElementById('chat-messages');
                                chatFeed.scrollTop = chatFeed.scrollHeight;
                            }
                        } catch (err) {
                            // Ignore partial JSON chunks
                        }
                    }
                }
            }
            
            addToHistory('model', fullReplyText);

            // Save response to IndexedDB
            if (currentChatId !== null) {
                try {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'model',
                        text: fullReplyText,
                        timestamp: Date.now()
                    });
                } catch (dbErr) {
                    console.error("Failed to save model response to DB:", dbErr);
                }
            }

            // Auto-name chat session if it's the first Q&A exchange
            if (isNewSession && currentChatId !== null) {
                autoGenerateChatTitle(currentChatId, lastVoiceTranscription || "Voice Query", fullReplyText);
            }
            
            // Show speak button now that stream is completed
            const speakBtnWrapper = messageWrapper.querySelector('.message-actions');
            if (speakBtnWrapper) {
                speakBtnWrapper.style.display = 'block';
            }
            
            // Auto-read response since query came from voice!
            const speakButtons = document.querySelectorAll('.btn-speak');
            if (speakButtons.length > 0) {
                const lastBtn = speakButtons[speakButtons.length - 1];
                speakMessage(lastBtn); // Trigger play voice using our new Gemini TTS engine!
            }
        } else {
            if (!response.ok) {
                console.error("Backend error:", response.statusText);
                const errorReply = currentLanguage === 'hi'
                    ? "माफ़ कीजिये, सर्वर से संपर्क करने में असमर्थ। कृपया बाद में प्रयास करें।"
                    : "Sorry, I am having trouble connecting to the server. Please try again later.";
                appendMessage('assistant', errorReply);
                addToHistory('model', errorReply);
                if (currentChatId !== null) {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'model',
                        text: errorReply,
                        timestamp: Date.now()
                    });
                }
            } else {
                const data = await response.json();
                
                // If there's user transcription in JSON
                const transcription = data.user_transcription || "Voice Query";
                const userTextBubble = document.getElementById('user-voice-transcription-placeholder');
                if (userTextBubble) {
                    userTextBubble.textContent = transcription;
                    userTextBubble.removeAttribute('id');
                }
                addToHistory('user', transcription);
                if (currentChatId !== null) {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'user',
                        text: transcription,
                        timestamp: Date.now()
                    });
                }
                
                appendMessage('assistant', data.reply);
                addToHistory('model', data.reply);
                if (currentChatId !== null) {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'model',
                        text: data.reply,
                        timestamp: Date.now()
                    });
                }
                
                if (isNewSession && currentChatId !== null) {
                    autoGenerateChatTitle(currentChatId, transcription, data.reply);
                }
            }
        }
    } catch (error) {
        hideTypingIndicator();
        if (error.name === 'AbortError') {
            console.log("Voice fetch request aborted cleanly.");
            const placeholder = document.getElementById('user-voice-transcription-placeholder');
            const transcription = placeholder ? placeholder.textContent : "Voice Query";
            if (placeholder) {
                placeholder.textContent = currentLanguage === 'hi' ? "आवाज प्रश्न रोक दिया गया" : "Voice query cancelled";
                placeholder.removeAttribute('id');
            }
            let cancelledMsg = "*Response stopped by user.*";
            if (currentLanguage === 'hi') {
                cancelledMsg = "*प्रतिक्रिया उपयोगकर्ता द्वारा रोक दी गई है।*";
            } else if (currentLanguage === 'hn') {
                cancelledMsg = "*Response user ne rok diya hai.*";
            }
            appendMessage('assistant', cancelledMsg);
            addToHistory('model', cancelledMsg);
            if (currentChatId !== null) {
                await RTOChatDB.saveMessage({
                    chat_id: currentChatId,
                    role: 'model',
                    text: cancelledMsg,
                    timestamp: Date.now()
                });
            }
            if (isNewSession && currentChatId !== null) {
                autoGenerateChatTitle(currentChatId, transcription, cancelledMsg);
            }
        } else {
            console.error("Network error connecting to backend:", error);
            
            const placeholder = document.getElementById('user-voice-transcription-placeholder');
            const transcription = placeholder ? placeholder.textContent : "Voice Query";
            if (placeholder) {
                placeholder.textContent = "Voice Query";
                placeholder.removeAttribute('id');
            }
            
            const offlineReply = currentLanguage === 'hi'
                ? "माफ़ कीजिये, सर्वर ऑफलाइन है। कृपया सुनिश्चित करें कि बैकएंड चल रहा है।"
                : "Sorry, the server is offline. Please make sure the backend is running.";
            appendMessage('assistant', offlineReply);
            addToHistory('model', offlineReply);
            if (currentChatId !== null) {
                await RTOChatDB.saveMessage({
                    chat_id: currentChatId,
                    role: 'model',
                    text: offlineReply,
                    timestamp: Date.now()
                });
            }
            if (isNewSession && currentChatId !== null) {
                autoGenerateChatTitle(currentChatId, transcription, offlineReply);
            }
        }
    } finally {
        setGeneratingState(false);
        activeChatController = null;
    }
}

// --------------------------------------------------------------------------
// Chat Logic & User Flows
// --------------------------------------------------------------------------

// Helper to render markdown text safely
let markedConfigured = false;
function renderMarkdown(text) {
    if (window.marked && window.marked.parse) {
        if (!markedConfigured) {
            try {
                window.marked.use({ breaks: true, gfm: true });
                markedConfigured = true;
            } catch (e) {
                try {
                    window.marked.setOptions({ breaks: true, gfm: true });
                    markedConfigured = true;
                } catch (err) {}
            }
        }
        return window.marked.parse(text);
    }
    return text.replace(/\n/g, '<br>');
}

// Append an empty assistant message bubble to stream text into
function appendEmptyAssistantBubble() {
    const chatFeed = document.getElementById('chat-messages');
    const msgElement = document.createElement('div');
    msgElement.className = 'message assistant';
    
    const avatarIcon = `<svg class="logo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="50" cy="50" r="48" fill="url(#logoGrad)" class="logo-circle-bg" />
                          <path d="M30 48C30 30 70 30 70 48" stroke="white" stroke-width="6" fill="none" stroke-linecap="round" />
                          <rect x="28" y="38" width="44" height="32" rx="10" fill="white" />
                          <rect x="34" y="44" width="32" height="12" rx="6" fill="#1e293b" />
                          <circle cx="44" cy="50" r="3.5" fill="#60a5fa" class="logo-hub-spark" />
                          <circle cx="56" cy="50" r="3.5" fill="#60a5fa" class="logo-hub-spark" />
                          <rect x="23" y="43" width="7" height="14" rx="3" fill="white" />
                          <rect x="70" y="43" width="7" height="14" rx="3" fill="white" />
                        </svg>`;
                        
    msgElement.innerHTML = `
        <div class="avatar" aria-hidden="true">${avatarIcon}</div>
        <div class="message-wrapper">
            <div class="message-content">
                <div class="message-text"></div>
            </div>
            <div class="message-actions" style="display: none;">
                <button class="btn-speak" onclick="speakMessage(this)" aria-label="${uiStrings[currentLanguage].btnSpeak}">
                    <i class="fa-solid fa-volume-high"></i> ${uiStrings[currentLanguage].btnSpeak}
                </button>
            </div>
        </div>
    `;
    
    chatFeed.appendChild(msgElement);
    chatFeed.scrollTop = chatFeed.scrollHeight;
    return msgElement.querySelector('.message-wrapper');
}

function appendMessage(sender, text) {
    const chatFeed = document.getElementById('chat-messages');
    const msgElement = document.createElement('div');
    msgElement.className = `message ${sender}`;
    
    // Visor Robot SVG Logo (Same as Header/Sidebar)
    const avatarIcon = sender === 'assistant' 
        ? `<svg class="logo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="48" fill="url(#logoGrad)" class="logo-circle-bg" />
              <path d="M30 48C30 30 70 30 70 48" stroke="white" stroke-width="6" fill="none" stroke-linecap="round" />
              <rect x="28" y="38" width="44" height="32" rx="10" fill="white" />
              <rect x="34" y="44" width="32" height="12" rx="6" fill="#1e293b" />
              <circle cx="44" cy="50" r="3.5" fill="#60a5fa" class="logo-hub-spark" />
              <circle cx="56" cy="50" r="3.5" fill="#60a5fa" class="logo-hub-spark" />
              <rect x="23" y="43" width="7" height="14" rx="3" fill="white" />
              <rect x="70" y="43" width="7" height="14" rx="3" fill="white" />
            </svg>` 
        : '<i class="fa-solid fa-user"></i>';
    
    if (sender === 'assistant') {
        msgElement.innerHTML = `
            <div class="avatar" aria-hidden="true">${avatarIcon}</div>
            <div class="message-wrapper">
                <div class="message-content">
                    <div class="message-text">${renderMarkdown(text)}</div>
                </div>
                <div class="message-actions">
                    <button class="btn-speak" onclick="speakMessage(this)" aria-label="${uiStrings[currentLanguage].btnSpeak}">
                        <i class="fa-solid fa-volume-high"></i> ${uiStrings[currentLanguage].btnSpeak}
                    </button>
                </div>
            </div>
        `;
    } else {
        msgElement.innerHTML = `
            <div class="avatar" aria-hidden="true">${avatarIcon}</div>
            <div class="message-wrapper">
                <div class="message-content">
                    <div class="message-text">${text}</div>
                </div>
            </div>
        `;
    }
    
    chatFeed.appendChild(msgElement);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

function showTypingIndicator() {
    const chatFeed = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.className = 'message assistant typing-indicator-item';
    indicator.id = 'typing-indicator';
    
    const avatarIcon = `<svg class="logo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="50" cy="50" r="48" fill="url(#logoGrad)" class="logo-circle-bg" />
                          <path d="M30 48C30 30 70 30 70 48" stroke="white" stroke-width="6" fill="none" stroke-linecap="round" />
                          <rect x="28" y="38" width="44" height="32" rx="10" fill="white" />
                          <rect x="34" y="44" width="32" height="12" rx="6" fill="#1e293b" />
                          <circle cx="44" cy="50" r="3.5" fill="#60a5fa" class="logo-hub-spark" />
                          <circle cx="56" cy="50" r="3.5" fill="#60a5fa" class="logo-hub-spark" />
                          <rect x="23" y="43" width="7" height="14" rx="3" fill="white" />
                          <rect x="70" y="43" width="7" height="14" rx="3" fill="white" />
                        </svg>`;
    
    indicator.innerHTML = `
        <div class="avatar" aria-hidden="true">${avatarIcon}</div>
        <div class="message-wrapper">
            <div class="message-content typing-bubble">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    
    chatFeed.appendChild(indicator);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) {
        indicator.remove();
    }
}

function setGeneratingState(generating) {
    isGenerating = generating;
    const inputField = document.getElementById('chat-query');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('voice-btn');
    
    if (generating) {
        if (inputField) {
            inputField.disabled = true;
            inputField.placeholder = uiStrings[currentLanguage].waitingPlaceholder || "Waiting for response...";
        }
        if (micBtn) {
            micBtn.disabled = true;
            micBtn.style.opacity = '0.5';
            micBtn.style.pointerEvents = 'none';
        }
        if (sendBtn) {
            sendBtn.innerHTML = '<i class="fa-solid fa-square"></i>';
            sendBtn.title = currentLanguage === 'hi' ? "रुकें" : "Stop generation";
            sendBtn.setAttribute('aria-label', 'Stop generation');
            sendBtn.classList.add('generating-stop');
        }
    } else {
        if (inputField) {
            inputField.disabled = false;
            inputField.placeholder = uiStrings[currentLanguage].placeholder || "Type your message here...";
        }
        if (micBtn) {
            micBtn.disabled = false;
            micBtn.style.opacity = '';
            micBtn.style.pointerEvents = '';
        }
        if (sendBtn) {
            sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
            sendBtn.title = currentLanguage === 'hi' ? "संदेश भेजें" : "Send message";
            sendBtn.setAttribute('aria-label', 'Send message');
            sendBtn.classList.remove('generating-stop');
        }
    }
}

function abortGeneration() {
    if (activeChatController) {
        activeChatController.abort();
        activeChatController = null;
        console.log("Chat response generation aborted by user.");
    }
}

// Fade out and slide up the welcome screen when conversation starts
function hideWelcomeScreen() {
    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen && !welcomeScreen.classList.contains('fade-out')) {
        welcomeScreen.classList.add('fade-out');
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
        }, 400); // 400ms matches CSS transition duration
    }
}

// Escape HTML to prevent injection in list rendering
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// Fetch all saved chats and render them in the sidebar
async function loadRecentChatsList() {
    const listContainer = document.getElementById('recent-chats-list');
    if (!listContainer) return;

    try {
        const chats = await RTOChatDB.getChats();
        listContainer.innerHTML = '';

        if (chats.length === 0) {
            listContainer.innerHTML = `<div style="padding: 10px 12px; font-size: var(--fs-xs); color: var(--text-muted); font-style: italic;" data-en="No recent chats" data-hi="कोई हालिया चैट नहीं" data-hn="No recent chats">No recent chats</div>`;
            return;
        }

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = `recent-chat-item ${currentChatId === chat.id ? 'active' : ''}`;
            item.setAttribute('data-chat-id', chat.id);
            item.innerHTML = `
                <a class="recent-chat-link" onclick="openChatSession(${chat.id})">
                    <i class="fa-regular fa-message"></i>
                    <span title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span>
                </a>
                <button class="btn-delete-chat" onclick="deleteChatSession(${chat.id}, event)" aria-label="Delete chat">
                    <i class="fa-regular fa-trash-can"></i>
                </button>
            `;
            listContainer.appendChild(item);
        });
    } catch (err) {
        console.error("Error loading recent chats:", err);
    }
}

// Open a saved chat session, restoring UI and memory cache
async function openChatSession(chatId) {
    if (isGenerating) return;

    try {
        console.log(`[BROWSER-LOG] Opening saved chat session ID: ${chatId}`);
        
        // Auto-close mobile sidebar drawer when selecting a chat on mobile
        if (window.innerWidth <= 900) {
            toggleSidebar(false);
        }

        const messages = await RTOChatDB.getMessages(chatId);
        
        // 1. Update active chat ID
        currentChatId = chatId;
        sessionStorage.setItem('rto-active-chat-id', chatId);
        
        // 2. Highlight active chat item in sidebar
        document.querySelectorAll('.recent-chat-item').forEach(item => {
            const id = parseInt(item.getAttribute('data-chat-id'));
            if (id === chatId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // 3. Clear message feed and hide welcome dashboard instantly
        const chatFeed = document.getElementById('chat-messages');
        if (chatFeed) {
            chatFeed.innerHTML = '';
        }
        
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.classList.add('fade-out');
            welcomeScreen.style.display = 'none';
        }

        // 4. Populate message bubbles in the viewport (static, no speaking/typing animations)
        conversationHistory.length = 0; // Clear memory cache array
        
        messages.forEach(msg => {
            const sender = msg.role === 'model' ? 'assistant' : 'user';
            appendMessage(sender, msg.text);
            // Push to memory cache
            conversationHistory.push({ role: msg.role, text: msg.text });
        });

        // Limit memory history to 20 items
        if (conversationHistory.length > 20) {
            conversationHistory.splice(0, conversationHistory.length - 20);
        }
        
        // Save to sessionStorage for page-reload fallback stability
        sessionStorage.setItem('rto-chat-history', JSON.stringify(conversationHistory));

        // Scroll chat viewport to bottom
        if (chatFeed) {
            chatFeed.scrollTop = chatFeed.scrollHeight;
        }

        // Focus text input field
        const inputField = document.getElementById('chat-query');
        if (inputField) {
            inputField.value = '';
            inputField.focus();
        }

        console.log(`Restored chat session ID: ${chatId}. Messages loaded: ${messages.length}`);
    } catch (err) {
        console.error("Error opening chat session:", err);
    }
}

// Delete an individual chat session cascadingly
async function deleteChatSession(chatId, event) {
    if (event) {
        event.stopPropagation(); // Avoid selecting the chat during deletion click
    }

    const confirmMsg = currentLanguage === 'hi' 
        ? "क्या आप इस चैट इतिहास को हटाना चाहते हैं?" 
        : (currentLanguage === 'hn' ? "Kya aap ye chat history delete karna chahte hai?" : "Are you sure you want to delete this chat history?");

    if (confirm(confirmMsg)) {
        try {
            await RTOChatDB.deleteChat(chatId);
            console.log(`Deleted chat session ID: ${chatId}`);

            // If the deleted chat was the currently active one, reset to a new chat state
            if (currentChatId === chatId) {
                startNewChat();
            }

            // Reload sidebar list
            loadRecentChatsList();
        } catch (err) {
            console.error("Error deleting chat session:", err);
        }
    }
}

// Dynamically generate a title for the active chat session based on first Q&A exchange
async function autoGenerateChatTitle(chatId, userMsgText, assistantReplyText) {
    try {
        console.log("[Title Generator] Fetching dynamic name from Gemini...");
        const response = await fetch(`${API_BASE_URL}/api/generate-title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: userMsgText, reply: assistantReplyText })
        });
        
        const data = await response.json();
        const title = data.title || 'New Chat';
        
        // Update database chat record
        const db = await RTOChatDB.open();
        const transaction = db.transaction('chats', 'readwrite');
        const store = transaction.objectStore('chats');
        
        // Retrieve existing chat object
        const getReq = store.get(chatId);
        getReq.onsuccess = () => {
            const chat = getReq.result;
            if (chat) {
                chat.title = title;
                store.put(chat);
            }
        };

        transaction.oncomplete = () => {
            console.log(`[Title Generator] Updated chat ID ${chatId} title to: '${title}'`);
            loadRecentChatsList(); // Refresh sidebar list
        };
    } catch (err) {
        console.warn("[Title Generator] Error calling backend title generator:", err);
    }
}

// Start a fresh chat session (clears history, UI feed, and restores welcome screen)
function startNewChat() {
    console.log("[BROWSER-LOG] Starting new chat session...");
    if (isGenerating) {
        abortGeneration();
    }
    
    // Auto-close mobile sidebar drawer when starting a new chat on mobile
    if (window.innerWidth <= 900) {
        toggleSidebar(false);
    }
    
    // 1. Reset active chat tracking ID
    currentChatId = null;
    
    // Remove active highlight from sidebar items
    document.querySelectorAll('.recent-chat-item').forEach(item => item.classList.remove('active'));
    
    // Collapse any expanded dashboard help cards back to the overview grid
    collapseCards();
    
    // 2. Clear session cache and local array
    conversationHistory.length = 0;
    sessionStorage.removeItem('rto-chat-history');
    sessionStorage.removeItem('rto-active-chat-id');
    
    // 3. Clear UI message bubbles
    const chatFeed = document.getElementById('chat-messages');
    if (chatFeed) {
        chatFeed.innerHTML = '';
    }
    
    // 4. Bring back the welcome screen dashboard
    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'flex';
        // Force reflow
        welcomeScreen.offsetHeight;
        welcomeScreen.classList.remove('fade-out');
    }
    
    // 5. Focus input
    const inputField = document.getElementById('chat-query');
    if (inputField) {
        inputField.value = '';
        inputField.focus();
    }
    
    console.log("Chat context cleared. Welcome screen reset.");
}

// Helper to add chat turns to memory history
function addToHistory(role, text) {
    conversationHistory.push({ role, text });
    if (conversationHistory.length > 20) {
        conversationHistory.shift(); // Limit context window growth
    }
    try {
        sessionStorage.setItem('rto-chat-history', JSON.stringify(conversationHistory));
    } catch (e) {
        console.warn("Failed to write to sessionStorage:", e);
    }
    console.log("Conversational Memory Cache Updated:", conversationHistory);
}

// Process the form submission
async function handleFormSubmit(event) {
    event.preventDefault();
    
    // Stop generation if clicked while active
    if (isGenerating) {
        abortGeneration();
        return;
    }
    
    const inputField = document.getElementById('chat-query');
    const userQuery = inputField.value.trim();
    if (!userQuery) return;
    
    // 1. Post user message
    appendMessage('user', userQuery);
    inputField.value = '';
    
    // Hide welcome screen if visible
    hideWelcomeScreen();
    
    // 2. Display assistant typing state indicator
    showTypingIndicator();
    
    // Set generating UI state & instantiate AbortController
    setGeneratingState(true);
    activeChatController = new AbortController();
    const signal = activeChatController.signal;
    
    // Capture voice flag state for this exchange
    const speakThisResponse = shouldSpeakReply;
    shouldSpeakReply = false; // Reset global immediately
    
    // If starting a new session, create it in database
    let isNewSession = false;
    if (currentChatId === null) {
        isNewSession = true;
        try {
            currentChatId = await RTOChatDB.saveChat({
                title: 'New Chat...',
                created_at: Date.now(),
                language: currentLanguage
            });
            sessionStorage.setItem('rto-active-chat-id', currentChatId);
            await loadRecentChatsList(); // Load in sidebar
        } catch (dbErr) {
            console.error("Failed to initialize chat in DB:", dbErr);
        }
    }

    // Save user message to IndexedDB
    if (currentChatId !== null) {
        try {
            await RTOChatDB.saveMessage({
                chat_id: currentChatId,
                role: 'user',
                text: userQuery,
                timestamp: Date.now()
            });
        } catch (dbErr) {
            console.error("Failed to save user message to DB:", dbErr);
        }
    }
    
    try {
        console.log(`[BROWSER-LOG] Submitting chat query to: ${API_BASE_URL}/api/chat`);
        console.log(`[BROWSER-LOG] Request payload -> Tone: ${currentTone}, Lang: ${currentLanguage}, History turns: ${conversationHistory.length}`);
        const startTime = performance.now();

        // Send request to Flask API backend
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                question: userQuery,
                language: currentLanguage,
                history: conversationHistory,
                tone: currentTone
            }),
            signal: signal
        });

        const elapsedMs = Math.round(performance.now() - startTime);
        console.log(`[BROWSER-LOG] Response received in ${elapsedMs}ms | Status: ${response.status} ${response.statusText} | Content-Type: ${response.headers.get('content-type')}`);
        
        // Add user query to conversation history for future turns
        addToHistory('user', userQuery);
        
        hideTypingIndicator();
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/event-stream')) {
            // 3. Set up the empty streaming bubble in the feed
            const messageWrapper = appendEmptyAssistantBubble();
            const textElement = messageWrapper.querySelector('.message-text');
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let fullReplyText = "";
            let streamBuffer = "";
            
            // Read and parse streaming chunks
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                streamBuffer += decoder.decode(value, { stream: true });
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop() || "";
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr) continue;
                            const data = JSON.parse(jsonStr);
                            if (data.reply) {
                                fullReplyText += data.reply;
                                // Parse markdown live using Marked.js
                                textElement.innerHTML = renderMarkdown(fullReplyText);
                                
                                // Scroll the chat to follow generation
                                const chatFeed = document.getElementById('chat-messages');
                                chatFeed.scrollTop = chatFeed.scrollHeight;
                            } else if (data.error) {
                                console.error("Stream generation error:", data.error);
                            }
                        } catch (err) {
                            // Ignore partial JSON chunks
                        }
                    }
                }
            }
            
            addToHistory('model', fullReplyText);
            
            // Save response to IndexedDB
            if (currentChatId !== null) {
                try {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'model',
                        text: fullReplyText,
                        timestamp: Date.now()
                    });
                } catch (dbErr) {
                    console.error("Failed to save model response to DB:", dbErr);
                }
            }

            // Auto-name chat session if it's the first Q&A exchange
            if (isNewSession && currentChatId !== null) {
                autoGenerateChatTitle(currentChatId, userQuery, fullReplyText);
            }
            
            // Show speak button now that stream is completed
            const speakBtnWrapper = messageWrapper.querySelector('.message-actions');
            if (speakBtnWrapper) {
                speakBtnWrapper.style.display = 'block';
                // Adjust scroll to accommodate the speak button height
                const chatFeed = document.getElementById('chat-messages');
                if (chatFeed) {
                    chatFeed.scrollTop = chatFeed.scrollHeight;
                }
            }
            
            // Auto-read response if query was input by voice
            if (speakThisResponse) {
                const speakButtons = document.querySelectorAll('.btn-speak');
                if (speakButtons.length > 0) {
                    const lastBtn = speakButtons[speakButtons.length - 1];
                    speakMessage(lastBtn);
                }
            }
        } else {
            // Fallback for standard JSON responses
            if (!response.ok) {
                console.error("Backend error:", response.statusText);
                const errorReply = currentLanguage === 'hi'
                    ? "माफ़ कीजिये, सर्वर से संपर्क करने में असमर्थ। कृपया बाद में प्रयास करें।"
                    : "Sorry, I am having trouble connecting to the server. Please try again later.";
                appendMessage('assistant', errorReply);
                addToHistory('model', errorReply);
                if (currentChatId !== null) {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'model',
                        text: errorReply,
                        timestamp: Date.now()
                    });
                }
            } else {
                const data = await response.json();
                appendMessage('assistant', data.reply);
                addToHistory('model', data.reply);
                if (currentChatId !== null) {
                    await RTOChatDB.saveMessage({
                        chat_id: currentChatId,
                        role: 'model',
                        text: data.reply,
                        timestamp: Date.now()
                    });
                }
                if (isNewSession && currentChatId !== null) {
                    autoGenerateChatTitle(currentChatId, userQuery, data.reply);
                }
            }
        }
    } catch (error) {
        hideTypingIndicator();
        if (error.name === 'AbortError') {
            console.log("Fetch request aborted cleanly.");
            // Append a note indicating the query response was stopped
            let cancelledMsg = "*Response stopped by user.*";
            if (currentLanguage === 'hi') {
                cancelledMsg = "*प्रतिक्रिया उपयोगकर्ता द्वारा रोक दी गई है।*";
            } else if (currentLanguage === 'hn') {
                cancelledMsg = "*Response user ne rok diya hai.*";
            }
            appendMessage('assistant', cancelledMsg);
            addToHistory('model', cancelledMsg);
            if (currentChatId !== null) {
                await RTOChatDB.saveMessage({
                    chat_id: currentChatId,
                    role: 'model',
                    text: cancelledMsg,
                    timestamp: Date.now()
                });
            }
            if (isNewSession && currentChatId !== null) {
                autoGenerateChatTitle(currentChatId, userQuery, cancelledMsg);
            }
        } else {
            console.error("Network error connecting to backend:", error);
            
            const offlineReply = currentLanguage === 'hi'
                ? "माफ़ कीजिये, सर्वर ऑफलाइन है। कृपया सुनिश्चित करें कि बैकएंड चल रहा है।"
                : "Sorry, the server is offline. Please make sure the backend is running.";
            appendMessage('assistant', offlineReply);
            addToHistory('model', offlineReply);
            if (currentChatId !== null) {
                await RTOChatDB.saveMessage({
                    chat_id: currentChatId,
                    role: 'model',
                    text: offlineReply,
                    timestamp: Date.now()
                });
            }
            if (isNewSession && currentChatId !== null) {
                autoGenerateChatTitle(currentChatId, userQuery, offlineReply);
            }
        }
    } finally {
        // Reset generating UI state
        setGeneratingState(false);
        activeChatController = null;
    }
}

// --------------------------------------------------------------------------
// Interactive Welcome Screen Dashboard Card Expand/Collapse & Option Actions
// --------------------------------------------------------------------------

// Expand a particular help topic card and reveal nested option queries
function expandCard(cardType, event) {
    const card = document.getElementById(`card-${cardType}`);
    if (!card || card.classList.contains('expanded')) return;
    
    // If user clicked directly on a sub-option button or back button, abort card expansion
    if (event.target.closest('button')) return;

    console.log(`[Dashboard] Expanding card: ${cardType}`);
    
    const grid = document.querySelector('.help-cards-grid');
    
    // 1. Calculate boundaries relative to the offset parent (the grid container)
    const cardRect = {
        top: card.offsetTop,
        left: card.offsetLeft,
        width: card.offsetWidth,
        height: card.offsetHeight
    };
    
    // 2. Insert placeholder immediately to reserve the grid cell dimensions and position
    const placeholder = document.createElement('div');
    placeholder.id = `placeholder-${cardType}`;
    placeholder.className = 'help-card-placeholder';
    placeholder.style.gridRow = window.getComputedStyle(card).gridRow;
    placeholder.style.gridColumn = window.getComputedStyle(card).gridColumn;
    placeholder.style.width = `${cardRect.width}px`;
    placeholder.style.height = `${cardRect.height}px`;
    card.parentNode.insertBefore(placeholder, card);

    // Save original grid-row and grid-column values in data attributes
    card.setAttribute('data-orig-row', window.getComputedStyle(card).gridRow);
    card.setAttribute('data-orig-col', window.getComputedStyle(card).gridColumn);

    // 3. Position the card absolutely using its initial rect layout boundaries, clearing grid limits
    card.style.position = 'absolute';
    card.style.gridRow = 'auto';
    card.style.gridColumn = 'auto';
    card.style.top = `${cardRect.top}px`;
    card.style.left = `${cardRect.left}px`;
    card.style.width = `${cardRect.width}px`;
    card.style.height = `${cardRect.height}px`;
    card.style.zIndex = '20';
    card.style.margin = '0';
    
    // Trigger browser layout recalculation before starting transition to anchor the absolute position
    card.offsetHeight;
    
    // 4. Mark active card and siblings, and transition to fill the grid container
    grid.classList.add('has-expanded');
    card.classList.add('expanded');
    card.style.top = '0';
    card.style.left = '0';
    card.style.width = '100%';
    card.style.height = '100%';
    
    const cards = document.querySelectorAll('.help-card');
    cards.forEach(c => {
        if (c.id !== `card-${cardType}`) {
            c.classList.add('hidden-card');
        }
    });
}

// Collapse the expanded card and restore the 4-card overview grid
function collapseCards(event) {
    if (event) {
        event.stopPropagation(); // Stop click from re-expanding the card
    }
    
    const card = document.querySelector('.help-card.expanded');
    if (!card) return;
    
    const cardType = card.id.replace('card-', '');
    console.log(`[Dashboard] Collapsing card: ${cardType}`);
    
    const grid = document.querySelector('.help-cards-grid');
    if (grid) {
        grid.classList.remove('has-expanded');
    }
    
    const placeholder = document.getElementById(`placeholder-${cardType}`);
    if (placeholder) {
        // 1. Transition card dimensions back to match placeholder slot bounds
        card.style.top = `${placeholder.offsetTop}px`;
        card.style.left = `${placeholder.offsetLeft}px`;
        card.style.width = `${placeholder.offsetWidth}px`;
        card.style.height = `${placeholder.offsetHeight}px`;
    }
    
    card.classList.remove('expanded');
    
    const cards = document.querySelectorAll('.help-card');
    cards.forEach(c => c.classList.remove('hidden-card'));
    
    // 2. Restore static grid layout and cleanup placeholder once animation completes (400ms)
    setTimeout(() => {
        card.style.position = '';
        card.style.top = '';
        card.style.left = '';
        card.style.width = '';
        card.style.height = '';
        card.style.zIndex = '';
        card.style.margin = '';
        
        // Restore grid-row and grid-column from data attributes
        const origRow = card.getAttribute('data-orig-row');
        const origCol = card.getAttribute('data-orig-col');
        if (origRow) card.style.gridRow = origRow;
        if (origCol) card.style.gridColumn = origCol;
        
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
    }, 400);
}

// Send selected card sub-option directly as a search query
function sendSubOptionQuery(btnElement, event) {
    if (event) {
        event.stopPropagation(); // Stop click event propagation
    }
    
    if (isGenerating) return;

    // Fetch translated query text according to currently active language
    const queryText = btnElement.getAttribute(`data-${currentLanguage}`);

    if (queryText) {
        // Close sidebar drawer on mobile
        toggleSidebar(false);
        
        const inputField = document.getElementById('chat-query');
        if (inputField) {
            inputField.value = queryText;
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
        }
    }
}

// --------------------------------------------------------------------------
// System Theme Detection, Auto-Sync & LocalStorage Load
// --------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // 1. Check user saved theme preference, fallback to 'system'
    const savedTheme = localStorage.getItem('rto-user-theme') || 'system';
    setTheme(savedTheme, false);

    // 2. Check user saved language preference, fallback to 'en'
    const savedLang = localStorage.getItem('rto-user-lang') || 'en';
    setLanguage(savedLang);

    // Check user saved tone preference, fallback to 'detailed'
    const savedTone = localStorage.getItem('rto-user-tone') || 'detailed';
    setTone(savedTone);

    // 3. Check user saved font size preference, fallback to 'md'
    const savedFontSize = localStorage.getItem('rto-user-font-size') || 'md';
    adjustTextSize(savedFontSize);

    // 4. Restore desktop sidebar state preference
    const savedSidebarState = localStorage.getItem('rto-desktop-sidebar-state') || 'expanded';
    const mainContainer = document.getElementById('chat-container');
    if (mainContainer) {
        if (savedSidebarState === 'collapsed') {
            mainContainer.classList.add('sidebar-collapsed');
        } else {
            mainContainer.classList.remove('sidebar-collapsed');
        }
    }

    // Listen for OS theme changes
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
            if (activeTheme === 'system') {
                const newTheme = event.matches ? 'dark' : 'light';
                const body = document.body;
                body.classList.remove('theme-light', 'theme-dark', 'theme-contrast');
                body.classList.add(`theme-${newTheme}`);
            }
        });
    }

    // 5. Initialize IndexedDB database and load recent chats
    RTOChatDB.open().then(async () => {
        await loadRecentChatsList();
        const savedChatId = sessionStorage.getItem('rto-active-chat-id');
        if (savedChatId) {
            console.log(`[Reload] Restoring active chat session ID: ${savedChatId}`);
            await openChatSession(parseInt(savedChatId));
        }
    }).catch(err => {
        console.error("Failed to open IndexedDB:", err);
    });

    // Set initialization complete
    isInitialized = true;
    console.log("Application initialization complete.");
});
