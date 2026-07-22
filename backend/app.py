import os
import json
import base64
import io
import time
from gtts import gTTS
import chromadb
from google import genai
from google.genai import types
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from chromadb.utils import embedding_functions

app = Flask(__name__)
CORS(app)  # Enable CORS for cross-origin frontend requests

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

# Load Gemini API credentials
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # Read local config file fallback if environment variable is absent
    key_path = os.path.join(os.path.dirname(__file__), "api_key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            GEMINI_API_KEY = f.read().strip()

# Initialize Google GenAI Client (Official 2026 SDK)
client = genai.Client(api_key=GEMINI_API_KEY)

# Initialize ChromaDB persistent client
chroma_client = chromadb.PersistentClient(path="./rto_vector_db")

class GeminiEmbeddingFunction(embedding_functions.EmbeddingFunction):
    def __call__(self, input):
        try:
            embed_res = client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=input
            )
            return [e.values for e in embed_res.embeddings]
        except Exception as e:
            print(f"[RENDER-LOG] Error generating embeddings: {e}")
            return [[0.0] * 3072 for _ in input]

gemini_ef = GeminiEmbeddingFunction()
collection = chroma_client.get_or_create_collection(name="rto_rules", embedding_function=gemini_ef)

@app.route("/", methods=["GET"])
def home():
    # Check if a dynamic frontend localtunnel URL is active
    frontend_target_url = "https://rto-digital-assistant.vercel.app/"
    fe_file = os.path.join(os.path.dirname(__file__), "tunnel_fe_url.txt")
    if os.path.exists(fe_file):
        try:
            with open(fe_file, "r", encoding="utf-8") as f:
                active_fe_url = f.read().strip()
                if active_fe_url:
                    frontend_target_url = active_fe_url
        except Exception:
            pass

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RTO Digital Assistant API — Service Online</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
                font-family: 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif;
                background: #0f172a;
                color: #f8fafc;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1.5rem;
                background-image: 
                    radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
                    radial-gradient(at 100% 100%, rgba(14, 165, 233, 0.15) 0px, transparent 50%);
            }}
            .card {{
                background: rgba(30, 41, 59, 0.7);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 2.5rem;
                max-width: 520px;
                width: 100%;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                text-align: center;
            }}
            .badge {{
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: rgba(34, 197, 94, 0.1);
                border: 1px solid rgba(34, 197, 94, 0.3);
                color: #4ade80;
                padding: 6px 14px;
                border-radius: 9999px;
                font-size: 0.85rem;
                font-weight: 500;
                margin-bottom: 1.5rem;
            }}
            .dot {{
                width: 8px;
                height: 8px;
                background-color: #22c55e;
                border-radius: 50%;
                box-shadow: 0 0 10px #22c55e;
                animation: pulse 2s infinite;
            }}
            @keyframes pulse {{
                0% {{ transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }}
                70% {{ transform: scale(1); box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }}
                100% {{ transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }}
            }}
            h1 {{
                font-size: 1.75rem;
                font-weight: 600;
                margin-bottom: 0.75rem;
                background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            p {{
                color: #94a3b8;
                font-size: 0.95rem;
                line-height: 1.6;
                margin-bottom: 2rem;
            }}
            .btn {{
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                width: 100%;
                background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
                color: #ffffff;
                text-decoration: none;
                font-weight: 600;
                font-size: 1rem;
                padding: 1rem 1.5rem;
                border-radius: 14px;
                box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.4);
                transition: all 0.25s ease;
            }}
            .btn:hover {{
                transform: translateY(-2px);
                box-shadow: 0 15px 30px -5px rgba(37, 99, 235, 0.6);
            }}
            .features {{
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                margin-top: 2rem;
                padding-top: 1.5rem;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                text-align: left;
            }}
            .feature-item {{
                font-size: 0.8rem;
                color: #cbd5e1;
                display: flex;
                align-items: center;
                gap: 6px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="badge">
                <span class="dot"></span>
                Backend API Operational
            </div>
            <h1>RTO Digital Assistant Server</h1>
            <p>The backend service is online and ready. All AI vector RAG features, speech engines, and Gemini 3.1 streaming models are running.</p>
            <a href="{frontend_target_url}" class="btn">
                Launch Assistant Web App 🚀
            </a>
            <div class="features">
                <div class="feature-item">⚡ Gemini 3.1 LLM</div>
                <div class="feature-item">🔍 ChromaDB Vector RAG</div>
                <div class="feature-item">🎙️ Native Voice & TTS</div>
                <div class="feature-item">🌐 Multi-Lingual Sync</div>
            </div>
        </div>
    </body>
    </html>
    """
    return html_content, 200, {'Content-Type': 'text/html; charset=utf-8'}

@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        user_data = request.json or {}
        user_question = user_data.get("question", "")
        user_audio = user_data.get("audio", "")
        audio_mime = user_data.get("mime_type", "audio/webm")
        user_lang = user_data.get("language", "en")
        user_tone = user_data.get("tone", "detailed")

        # Format conversation logs for model context
        raw_history = user_data.get("history", [])
        print(f"\n[RENDER-LOG] === Incoming POST /api/chat ===")
        print(f"[RENDER-LOG] Query: '{user_question[:80]}...' | Tone: {user_tone} | Lang: {user_lang} | History payload count: {len(raw_history)}")

        formatted_history = []
        for item in raw_history:
            role = "user" if item.get("role") == "user" else "model"
            text = item.get("text", "").strip()
            if not text:
                continue
            # Prevent consecutive identical roles
            if formatted_history and formatted_history[-1]["role"] == role:
                continue
            formatted_history.append({
                "role": role,
                "parts": [text]
            })

        # History passed to start_chat must end with a 'model' turn so send_message appends the new 'user' turn
        if formatted_history and formatted_history[-1]["role"] == "user":
            formatted_history.pop()

        if not user_question and not user_audio:
            return jsonify({"error": "No question or audio provided"}), 400

        # 1. Handle voice input transcription if audio payload is present
        query_text = user_question
        if user_audio:
            TRANS_MODELS = [
                "gemini-3.1-flash-lite",
                "gemini-3.5-flash-lite",
                "gemini-1.5-flash"
            ]
            trans_success = False
            for model_name in TRANS_MODELS:
                try:
                    audio_bytes = base64.b64decode(user_audio)
                    print(f"[RENDER-LOG] Attempting transcription using models/{model_name}...")
                    
                    transcribe_prompt = "Transcribe the user's voice message verbatim in its spoken language. Do not add any conversational response, greeting, or answers. Return ONLY the transcribed text."
                    if user_lang == "hi":
                        transcribe_prompt += " Specifically, transcribe Hindi/Hinglish speech using Devanagari script (Hindi characters) and English speech in English."
                    elif user_lang == "hn":
                        transcribe_prompt += " Specifically, transcribe Hindi/Hinglish speech using Roman/Latin script (Hinglish, e.g., 'mujhe driving license banana hai') and English speech in English."
                    else:
                        transcribe_prompt += " Specifically, transcribe the speech in English script."

                    transcribe_response = client.models.generate_content(
                        model=f"models/{model_name}",
                        contents=[
                            types.Part.from_bytes(data=audio_bytes, mime_type=audio_mime),
                            transcribe_prompt
                        ]
                    )
                    query_text = transcribe_response.text.strip()
                    print(f"[RENDER-LOG] Transcription success on models/{model_name}: '{query_text}'")
                    trans_success = True
                    break
                except Exception as trans_err:
                    print(f"[RENDER-LOG] Transcription model models/{model_name} failed: {trans_err}")
                    continue
            if not trans_success:
                print("[RENDER-LOG] All transcription models failed. Defaulting to empty query...")
                query_text = ""

        # 2. Rephrase follow-up query if history exists for optimized RAG retrieval
        search_query = query_text
        if formatted_history and query_text:
            try:
                rephrase_prompt = (
                    "You are a search query optimizer. Given the following chat conversation history and a new follow-up question from the user, "
                    "rephrase the follow-up question into a standalone, concise search query in English that can be used to search a database for answers. "
                    "Rule: Do NOT prefix the output with anything. Do NOT write 'Standalone Search Query: '. Return ONLY the rephrased query string.\n\n"
                    f"Chat History:\n{formatted_history}\n\n"
                    f"Follow-up Question: {query_text}\n\n"
                    "Optimized Standalone Search Query:"
                )
                rephrase_response = client.models.generate_content(
                    model="models/gemini-3.1-flash-lite",
                    contents=rephrase_prompt
                )
                search_query = rephrase_response.text.strip()
                print(f"[RENDER-LOG] RAG query condensed: '{query_text}' -> '{search_query}'")
            except Exception as rephrase_err:
                print(f"[RENDER-LOG] Failed to rephrase query: {rephrase_err}. Using original query text...")

        # 3. Query vector database for verified context matching search terms
        db_context = "No matching data found."
        try:
            col_count = collection.count()
            if col_count > 0 and search_query:
                results = collection.query(
                    query_texts=[search_query],
                    n_results=min(2, col_count)
                )
                if results and results['documents'] and results['documents'][0]:
                    db_context = " ".join(results['documents'][0])
            else:
                print("[RENDER-LOG] Chroma DB collection 'rto_rules' is empty or query is empty. Skipping retrieval...")
        except Exception as db_err:
            print(f"[RENDER-LOG] Error querying Chroma DB: {db_err}. Querying model without vector database context...")

        # Build dynamic target language rules
        lang_pref = "The user's default dashboard language is English. Prefer responding in English. However, ALWAYS match the language and script of the user's current message query. If the user asks in Hindi (Devanagari), reply in Hindi. If the user asks in Hinglish (Hindi written in Roman script), reply in Hinglish. If they ask in English, reply in English. Do not force English if the user types in another language."
        if user_lang == "hi":
            lang_pref = "The user's default dashboard language is Hindi. Prefer responding in Hindi (Devanagari script). However, ALWAYS match the language and script of the user's current message query. If the user asks in English, reply in English. If the user asks in Hinglish (Hindi written in Roman script), reply in Hinglish. If they ask in Hindi, reply in Hindi. Do not force Hindi if the user types in another language."
        elif user_lang == "hn":
            lang_pref = "The user's default dashboard language is Hinglish. Prefer responding in Hinglish (Hindi written in Roman/Latin script, e.g. 'Aap driving license status check kar sakte hai'). However, ALWAYS match the language and script of the user's current message query. If the user asks in English, reply in English. If the user asks in Hindi (Devanagari script), reply in Hindi. If they ask in Hinglish, reply in Hinglish. Do not force Hinglish if the user types in another language."

        # Build dynamic target length and formatting guidelines
        tone_pref = ""
        if user_tone == "quick":
            tone_pref = (
                "TONE PREFERENCE: Quick and Concise. "
                "Keep your responses very short, direct, and to the point. Focus only on answering exactly what was asked. "
                "If the user asks about an RTO service that can be done either online or offline, DO NOT explain both in detail immediately. "
                "Instead, first ask the user which mode they prefer (online or offline) in a friendly way, and then wait for their reply. "
                "HOWEVER, if the user explicitly asks for details or if a longer response is clearly necessary, be smart enough to provide it."
            )
        elif user_tone == "friendly":
            tone_pref = (
                "TONE PREFERENCE: Warm and Friendly. "
                "Talk like a supportive, casual local buddy who wants to help. "
                "Avoid writing overly long walls of text or listing every single detail unless requested. "
                "Keep responses conversational, welcoming, and easy to digest."
            )
        else: # detailed
            tone_pref = (
                "TONE PREFERENCE: Detailed and Comprehensive. "
                "Provide detailed, exhaustive guides covering all options, documents, rules, and steps (both online and offline) in full."
            )

        # 3. Compile system context and model instructions
        system_instruction = (
            "You are an incredibly warm, supportive, and friendly local buddy helping someone navigate the Dehradun RTO office. "
            "Your tone should be casual, encouraging, and clear (like talking to a friend, not a computer). "
            "ROADMAP & PREREQUISITES RULE: Always check for prerequisites and present sequential roadmaps. If the user asks a general question about getting a 'Driving License' or 'DL', you MUST explain that the process is divided into two phases: first obtaining a Learner's License (LL), holding it for 30 days, and then applying for the Permanent DL. Do not jump straight to the Permanent DL process unless they specify they already have a Learner's License. Similarly, for other RTO actions, mention prerequisites like: obtaining an NOC (Form 28) from the original state before re-registering an other-state vehicle, terminating hypothecation before doing an RC transfer if the vehicle is under a loan, and obtaining a Fitness Certificate (FC) before applying for commercial permits. "
            f"LANGUAGE RULE: {lang_pref} "
            f"{tone_pref} Note: These tone preferences are guidelines; if the user's question or instruction requires a different length or detail level, adapt smartly. "
            f"FIRST PRIORITY VERIFIED FACTS: {db_context}. "
            "If the answer can be found in these verified facts, prefer answering using them. "
            "If the answer cannot be found in the verified facts, you are allowed to use Google Search or your own general knowledge. "
            "HOWEVER, when using search or general knowledge for missing facts, you MUST explicitly start or prefix your response by stating "
            "that this information is not available directly through RTO verified records, but according to the web search or general info, it is: [answer]."
        )

        # 4. Invoke LLM and process stream response
        def generate():
            try:
                # Stream transcription first if input was audio
                if user_audio and query_text:
                    yield f"data: {json.dumps({'user_transcription': query_text})}\n\n"

                CHAT_MODELS = [
                    "gemini-3.1-flash-lite", # Primary (500 RPD free tier!)
                    "gemini-3.5-flash-lite", # Secondary (500 RPD free tier!)
                    "gemini-1.5-flash"       # Fallback
                ]

                successful_model = None

                for model_name in CHAT_MODELS:
                    try:
                        print(f"[RENDER-LOG] Connecting chat model: models/{model_name}...")
                        
                        # Build SDK history types
                        types_history = []
                        for h in formatted_history:
                            types_history.append(types.Content(
                                role=h["role"],
                                parts=[types.Part.from_text(text=h["parts"][0])]
                            ))

                        chat = client.chats.create(
                            model=f"models/{model_name}",
                            config=types.GenerateContentConfig(
                                system_instruction=system_instruction
                            ),
                            history=types_history
                        )
                        
                        stream = chat.send_message_stream(query_text)
                        
                        successful_model = model_name
                        print(f"[RENDER-LOG] Successfully connected to models/{model_name}!")
                        
                        for chunk in stream:
                            if chunk.text:
                                yield f"data: {json.dumps({'reply': chunk.text})}\n\n"
                        
                        break  # Streaming completed cleanly
                    except Exception as model_err:
                        print(f"[RENDER-LOG] Model models/{model_name} failed: {model_err}")
                        continue

                if not successful_model:
                    raise Exception("All chat models in the fallback chain failed or exceeded quotas.")

            except Exception as stream_err:
                yield f"data: {json.dumps({'error': str(stream_err)})}\n\n"

        # 5. Return SSE response stream wrapped in stream_with_context without buffering
        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            }
        )

    except Exception as e:
        import traceback
        print("\n[RENDER-LOG] === Backend Exception Occurred ===")
        traceback.print_exc()
        print("===================================\n")
        return jsonify({"error": str(e)}), 500

# TTS Engine configs: Gemini (Primary) -> gTTS (Secondary) -> browser Web Speech API (Fallback)
GTTS_LANG_MAP = {"en": "en", "hn": "en", "hi": "hi"}

GEMINI_TTS_MODELS = [
    "models/gemini-3.1-flash-tts-preview",
    "models/gemini-2.5-flash-preview-tts",
    "models/gemini-2.5-pro-preview-tts"
]

@app.route("/api/speak", methods=["POST"])
def speak():
    user_data = request.json or {}
    text = user_data.get("text", "")
    lang = user_data.get("lang", "en")

    if not text:
        return jsonify({"error": "No text provided"}), 400

    # --- Tier 1: Gemini Native Speech Generation ---
    try:
        print("[RENDER-LOG] Attempting Gemini native TTS...")
        for model_name in GEMINI_TTS_MODELS:
            try:
                config = types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
                        )
                    )
                )
                response = client.models.generate_content(
                    model=model_name,
                    contents=text,
                    config=config
                )
                audio_b64 = ""
                if response.candidates and response.candidates[0].content:
                    for part in response.candidates[0].content.parts:
                        if hasattr(part, 'inline_data') and part.inline_data:
                            audio_b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                            break
                if audio_b64:
                    print(f"[RENDER-LOG] Gemini TTS success using {model_name}")
                    return jsonify({"audio": audio_b64, "format": "pcm", "engine": f"gemini:{model_name}"})
            except Exception as gem_err:
                print(f"[RENDER-LOG] Gemini model {model_name} failed: {gem_err}")
                continue
        raise Exception("All Gemini TTS models failed or quota exceeded")
    except Exception as gemini_fail:
        print(f"[RENDER-LOG] Gemini TTS unavailable: {gemini_fail}. Falling back to gTTS...")

    # --- Tier 2: gTTS Fallback ---
    try:
        gtts_lang = GTTS_LANG_MAP.get(lang, "en")
        print(f"[RENDER-LOG] Using gTTS fallback | lang: {lang} → gtts_lang: {gtts_lang}")
        tts = gTTS(text=text, lang=gtts_lang)
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        audio_b64 = base64.b64encode(fp.read()).decode('utf-8')
        return jsonify({"audio": audio_b64, "format": "mp3", "engine": f"gtts:{gtts_lang}"})
    except Exception as gtts_fail:
        print(f"[RENDER-LOG] gTTS also failed: {gtts_fail}. Signalling browser fallback...")

    # --- Tier 3: Browser Fallback Notification ---
    return jsonify({"error": "browser_fallback", "lang": lang}), 503

@app.route("/api/generate-title", methods=["POST"])
def generate_title():
    try:
        user_data = request.json or {}
        question = user_data.get("question", "")
        reply = user_data.get("reply", "")

        if not question:
            return jsonify({"title": "New Chat"}), 200

        prompt = (
            "Generate a very short, concise title (strictly 3 to 5 words) summarizing the following Q&A exchange between a user and an RTO Assistant. "
            "Do NOT include any quotation marks, markdown styling, prefixes like 'Title:', or terminal punctuation in the output. "
            "Return ONLY the plain title text. "
            "Crucial Rule: Generate the title in the same language and script as the user query.\n\n"
            f"User Query: {question}\n"
            f"Assistant Reply: {reply}\n\n"
            "Summary Title:"
        )

        response = client.models.generate_content(
            model="models/gemini-3.1-flash-lite",
            contents=prompt
        )
        title = response.text.strip().replace('"', '').replace("'", "")
        
        if not title or len(title) > 60:
            title = "New Chat"
            
        print(f"[RENDER-LOG] Generated title: '{title}'")
        return jsonify({"title": title})
    except Exception as err:
        print(f"[RENDER-LOG] Error generating title: {err}")
        return jsonify({"title": "New Chat"}), 200

if __name__ == "__main__":
    # Start local development server
    app.run(port=5000, debug=True)