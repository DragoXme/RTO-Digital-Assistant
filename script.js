/* ==========================================================================
   RTO Digital Assistant - Interactive Client Logic & Accessibility
   ========================================================================== */

// Global State
let currentLanguage = 'en';
let currentFontSize = 'md'; // sm, md, lg, xl
let activeTheme = 'light'; // light, dark, contrast
let isListening = false;
let voiceTimeout = null;
let userHasManuallySetTheme = false;
let shouldSpeakReply = false; // Flag to speak the next assistant reply automatically

// Initialize Web Speech Recognition
let recognition = null;
let finalSpeechText = ''; // Track transcribed speech text across events
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true; // Enabled interim results for live voice typing
}

// Web Audio Visualizer Globals (Real-Time Mic Visualizer)
let audioContext = null;
let audioSource = null;
let analyser = null;
let audioStream = null;
let visualizerFrameId = null;

// Bilingual UI Text Map
const uiStrings = {
    en: {
        welcome: "Namaste! Welcome to the RTO Digital Assistant. I am designed to help citizens of Uttarakhand find RTO information easily.<br><br>Feel free to ask me anything about <strong>Driving Licenses</strong>, <strong>Vehicle RC</strong>, or <strong>Challans</strong>.",
        placeholder: "Type your message here...",
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
        welcome: "नमस्ते! आरटीओ डिजिटल सहायक में आपका स्वागत है। मुझे उत्तराखंड के नागरिकों को आसानी से आरटीओ जानकारी खोजने में मदद करने के लिए डिज़ाइन किया गया है।<br><br>आप मुझसे <strong>ड्राइविंग लाइसेंस</strong>, <strong>वाहन आरसी</strong>, या <strong>चालान</strong> के बारे में कुछ भी पूछ सकते हैं।",
        placeholder: "अपना संदेश यहाँ लिखें...",
        btnSpeak: "बोलें",
        listening: "सुन रहा हूँ...",
        transcribing: "लिख रहा हूँ...",
        defaultReply: "मैं जल्द ही तैयार हो जाऊंगा...",
        voiceResult: "ड्राइविंग लाइसेंस की स्थिति कैसे जांचें?",
        workingHours: "कार्य समय: सुबह 10:00 - शाम 5:00 (सोमवार से शनिवार)",
        senderAssistant: "आरटीओ सहायक",
        senderUser: "आप"
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
    
    // Update toggle button states
    document.getElementById('lang-en').classList.remove('active');
    document.getElementById('lang-hi').classList.remove('active');
    document.getElementById('lang-en').setAttribute('aria-pressed', 'false');
    document.getElementById('lang-hi').setAttribute('aria-pressed', 'false');
    
    document.getElementById(`lang-${lang}`).classList.add('active');
    document.getElementById(`lang-${lang}`).setAttribute('aria-pressed', 'true');
    
    // Translate standard UI text blocks
    document.getElementById('user-input').placeholder = uiStrings[lang].placeholder;
    
    // Translate working hours in sidebar
    const workingHoursElement = document.querySelector('.working-hours');
    if (workingHoursElement) {
        workingHoursElement.textContent = uiStrings[lang].workingHours;
    }
    
    // Translate help topics in sidebar (data-attributes)
    document.querySelectorAll('.help-link-text span').forEach(span => {
        const text = span.getAttribute(`data-${lang}`);
        if (text) {
            span.textContent = text;
        }
    });

    // Dynamic translate greeting message if it is the only/first message
    const welcomeMsg = document.getElementById('welcome-msg');
    if (welcomeMsg && welcomeMsg.closest('.message').nextElementSibling === null) {
        welcomeMsg.innerHTML = uiStrings[lang].welcome;
    }
}

// --------------------------------------------------------------------------
// Accessibility: Text-to-Speech (Audio assistance)
// --------------------------------------------------------------------------

function speakMessage(btnElement) {
    // Find text inside the message wrapper
    const messageWrapper = btnElement.closest('.message-wrapper');
    const textElement = messageWrapper.querySelector('.message-text');
    const textToSpeak = textElement.textContent || textElement.innerText;
    
    // Toggle speaking state
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        resetSpeakButtons();
        return;
    }
    
    // Set up Speech Synthesis
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    // Attempt to match Hindi vs English voice
    const voices = window.speechSynthesis.getVoices();
    if (currentLanguage === 'hi') {
        const hiVoice = voices.find(voice => voice.lang.includes('hi') || voice.lang.includes('IN'));
        if (hiVoice) utterance.voice = hiVoice;
    } else {
        const enVoice = voices.find(voice => voice.lang.includes('en') || voice.lang.includes('US') || voice.lang.includes('GB'));
        if (enVoice) utterance.voice = enVoice;
    }
    
    // Adjust rate for seniors (slightly slower than normal)
    utterance.rate = 0.85; 
    
    // Change speaker icon to visual "stop" animation
    btnElement.innerHTML = '<i class="fa-solid fa-circle-stop" style="color: #ef4444;"></i> Stop';
    
    utterance.onend = () => {
        resetSpeakButtons();
    };
    
    utterance.onerror = () => {
        resetSpeakButtons();
    };
    
    window.speechSynthesis.speak(utterance);
}

function resetSpeakButtons() {
    document.querySelectorAll('.btn-speak').forEach(btn => {
        btn.innerHTML = `<i class="fa-solid fa-volume-high"></i> ${uiStrings[currentLanguage].btnSpeak}`;
    });
}

// Ensure voices are loaded (needed in some browsers)
if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {};
}

// --------------------------------------------------------------------------
// Real-Time Web Audio Visualizer (3 Thicker Waves)
// --------------------------------------------------------------------------

async function startAudioVisualization() {
    try {
        const bar1 = document.getElementById('wave-bar-1');
        const bar2 = document.getElementById('wave-bar-2');
        const bar3 = document.getElementById('wave-bar-3');

        // Request audio stream from microphone
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create Audio Context
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
        
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

function toggleVoiceInput() {
    const inputField = document.getElementById('user-input');
    const waveContainer = document.getElementById('voice-waves');
    const indicatorText = document.getElementById('voice-text-indicator');
    const micBtn = document.getElementById('voice-btn');
    const sendBtn = document.getElementById('send-btn');
    
    if (isListening) {
        // Stop Listening
        isListening = false;
        stopAudioVisualization(); // Stop the real-time audio visualization
        
        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                console.warn("SpeechRecognition already stopped:", e);
            }
        } else {
            clearTimeout(voiceTimeout);
        }
        
        // Restore normal state
        waveContainer.style.display = 'none';
        inputField.style.display = 'block';
        
        micBtn.classList.remove('listening-active');
        sendBtn.removeAttribute('disabled');
    } else {
        // Start Listening
        isListening = true;
        finalSpeechText = ''; // Reset gathered text
        
        // Swap inputs
        inputField.style.display = 'none';
        waveContainer.style.display = 'flex';
        indicatorText.textContent = uiStrings[currentLanguage].listening;
        
        micBtn.classList.add('listening-active');
        sendBtn.setAttribute('disabled', 'true');
        
        if (recognition) {
            // Set language matching user choice
            recognition.lang = currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';
            
            recognition.onstart = () => {
                indicatorText.textContent = uiStrings[currentLanguage].listening;
                
                // Avoid audio hardware conflicts on mobile (Android blocks parallel mic streams)
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                if (!isMobile) {
                    startAudioVisualization();
                } else {
                    restoreFallbackWaveAnimation();
                }
            };
            
            recognition.onresult = (event) => {
                let fullTranscript = '';
                let interimTranscript = '';
                
                // Read current results list (accumulating final and interim outputs)
                for (let i = 0; i < event.results.length; ++i) {
                    const transcriptPiece = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        fullTranscript += transcriptPiece;
                    } else {
                        interimTranscript += transcriptPiece;
                    }
                }
                
                const liveText = fullTranscript + interimTranscript;
                if (liveText.trim()) {
                    indicatorText.textContent = liveText;
                }
                
                // Cache final output to submit on completion
                finalSpeechText = fullTranscript;
            };
            
            recognition.onerror = (event) => {
                console.error("Speech recognition error:", event.error);
                
                let errorMsg = "Speech error: " + event.error;
                if (event.error === 'network') {
                    errorMsg = currentLanguage === 'hi' 
                        ? "नेटवर्क त्रुटि: कृपया जांचें कि इंटरनेट चालू है या नहीं।" 
                        : "Network error: Please check if your phone has internet.";
                } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    errorMsg = currentLanguage === 'hi'
                        ? "अनुमति अस्वीकृत: सेटिंग्स में माइक को अनुमति दें।"
                        : "Permission blocked: Please allow mic access.";
                } else if (event.error === 'no-speech') {
                    errorMsg = currentLanguage === 'hi' ? "कोई आवाज़ नहीं सुनी गई।" : "No speech detected.";
                }
                
                // Print error on voice wave capsule
                indicatorText.textContent = errorMsg;
                
                // Flatten waves to indicate stopped state
                const bar1 = document.getElementById('wave-bar-1');
                const bar2 = document.getElementById('wave-bar-2');
                const bar3 = document.getElementById('wave-bar-3');
                if (bar1 && bar2 && bar3) {
                    bar1.classList.remove('animated');
                    bar2.classList.remove('animated');
                    bar3.classList.remove('animated');
                    bar1.style.height = '4px';
                    bar2.style.height = '4px';
                    bar3.style.height = '4px';
                }
                
                // Release audio capture
                stopAudioVisualization();
                
                // Wait 3.5 seconds, then reset UI back to text input
                setTimeout(() => {
                    if (isListening) {
                        toggleVoiceInput();
                    }
                }, 3500);
            };
            
            recognition.onend = () => {
                if (isListening) {
                    let spokenText = finalSpeechText.trim();
                    if (!spokenText) {
                        // Fallback: check if the indicator contains words (if OS ended before finalizing list)
                        const currentIndicator = indicatorText.textContent;
                        if (currentIndicator !== uiStrings[currentLanguage].listening && 
                            currentIndicator !== uiStrings[currentLanguage].transcribing) {
                            spokenText = currentIndicator.trim();
                        }
                    }
                    
                    if (spokenText) {
                        inputField.value = spokenText;
                        indicatorText.textContent = spokenText;
                        
                        // Stop microphone visualizer loop & release mic hardware immediately
                        stopAudioVisualization();
                        
                        // Flatten waves to indicate recording has finished
                        const bar1 = document.getElementById('wave-bar-1');
                        const bar2 = document.getElementById('wave-bar-2');
                        const bar3 = document.getElementById('wave-bar-3');
                        if (bar1 && bar2 && bar3) {
                            bar1.classList.remove('animated');
                            bar2.classList.remove('animated');
                            bar3.classList.remove('animated');
                            bar1.style.height = '4px';
                            bar2.style.height = '4px';
                            bar3.style.height = '4px';
                        }
                        
                        // Delay auto-submission by 1.5 seconds for user review
                        setTimeout(() => {
                            if (isListening) {
                                shouldSpeakReply = true; // Flag that this query came from voice
                                
                                // Restore normal input field layout
                                waveContainer.style.display = 'none';
                                inputField.style.display = 'block';
                                isListening = false;
                                micBtn.classList.remove('listening-active');
                                sendBtn.removeAttribute('disabled');
                                
                                document.getElementById('chat-form').dispatchEvent(new Event('submit'));
                            }
                        }, 1500);
                    } else {
                        toggleVoiceInput(); // Cancel and reset UI
                    }
                }
            };
            
            try {
                recognition.start();
            } catch (e) {
                console.error("Failed to start speech recognition:", e);
                toggleVoiceInput();
            }
        } else {
            // Fallback for browsers that don't support Web Speech API
            voiceTimeout = setTimeout(() => {
                indicatorText.textContent = uiStrings[currentLanguage].transcribing;
                
                voiceTimeout = setTimeout(() => {
                    isListening = false;
                    const transcribedVal = uiStrings[currentLanguage].voiceResult;
                    inputField.value = transcribedVal;
                    
                    waveContainer.style.display = 'none';
                    inputField.style.display = 'block';
                    
                    micBtn.classList.remove('listening-active');
                    sendBtn.removeAttribute('disabled');
                    shouldSpeakReply = true; // Flag for fallback simulator voice query
                    
                    document.getElementById('chat-form').dispatchEvent(new Event('submit'));
                }, 1200);
            }, 1200);
        }
    }
}

// --------------------------------------------------------------------------
// Chat Logic & User Flows
// --------------------------------------------------------------------------

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
                    <div class="message-text">${text}</div>
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

// Process the form submission
function handleFormSubmit(event) {
    event.preventDefault();
    
    const inputField = document.getElementById('user-input');
    const userQuery = inputField.value.trim();
    if (!userQuery) return;
    
    // 1. Post user message
    appendMessage('user', userQuery);
    inputField.value = '';
    
    // 2. Show agent typing indicator
    showTypingIndicator();
    
    // Capture voice flag state for this exchange
    const speakThisResponse = shouldSpeakReply;
    shouldSpeakReply = false; // Reset global immediately
    
    // 3. Trigger delayed mock response
    setTimeout(() => {
        hideTypingIndicator();
        
        // Strictly reply with the requested string for any input
        const reply = uiStrings[currentLanguage].defaultReply;
        
        appendMessage('assistant', reply);
        
        // Auto-read response if query was input by voice
        if (speakThisResponse) {
            const speakButtons = document.querySelectorAll('.btn-speak');
            if (speakButtons.length > 0) {
                const lastBtn = speakButtons[speakButtons.length - 1];
                speakMessage(lastBtn);
            }
        }
    }, 1200);
}

// --------------------------------------------------------------------------
// Interaction Shortcuts (Sidebar links)
// --------------------------------------------------------------------------

function sendQuickQuery(topicId) {
    let queryText = '';
    
    if (topicId === 'apply-license') {
        queryText = currentLanguage === 'en' ? "How do I apply for a new Driving License?" : "नया ड्राइविंग लाइसेंस कैसे बनवाएं?";
    } else if (topicId === 'vehicle-rc') {
        queryText = currentLanguage === 'en' ? "How to check my Vehicle RC status?" : "अपने वाहन का आरसी स्टेटस कैसे जांचें?";
    } else if (topicId === 'pay-challan') {
        queryText = currentLanguage === 'en' ? "Steps to pay traffic challan online?" : "ट्रैफिक चालान ऑनलाइन भरने की प्रक्रिया?";
    } else if (topicId === 'book-slot') {
        queryText = currentLanguage === 'en' ? "Book driving test slot at Uttarakhand RTO" : "उत्तराखंड आरटीओ में ड्राइविंग टेस्ट स्लॉट बुक करें";
    }
    
    if (queryText) {
        // Close sidebar drawer on mobile
        toggleSidebar(false);
        
        const inputField = document.getElementById('user-input');
        inputField.value = queryText;
        document.getElementById('chat-form').dispatchEvent(new Event('submit'));
    }
}

// --------------------------------------------------------------------------
// System Theme Detection, Auto-Sync & LocalStorage Load
// --------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Check user saved theme preference, fallback to 'system'
    const savedTheme = localStorage.getItem('rto-user-theme') || 'system';
    setTheme(savedTheme, false);

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
});
