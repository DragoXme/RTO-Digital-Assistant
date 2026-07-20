import os
import google.generativeai as genai

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    key_path = os.path.join(os.path.dirname(__file__), "api_key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            GEMINI_API_KEY = f.read().strip()
genai.configure(api_key=GEMINI_API_KEY)

try:
    print("Testing generate_content on models/gemini-3.1-flash-tts-preview...")
    model = genai.GenerativeModel(
        model_name="models/gemini-3.1-flash-tts-preview"
    )
    # Configure request to ask for AUDIO output
    config = {
        "response_modalities": ["AUDIO"]
    }
    response = model.generate_content(
        "Say hello in a friendly voice.",
        generation_config=config
    )
    print("Success! Parts details:")
    for i, part in enumerate(response.candidates[0].content.parts):
        print(f"\n--- Part {i} ---")
        # Check text
        try:
            print("Text:", part.text)
        except Exception as e:
            print("No text or error reading text:", e)
        # Check inline_data
        if hasattr(part, 'inline_data') and part.inline_data:
            print("Has inline_data:")
            print("MimeType:", part.inline_data.mime_type)
            print("Data type:", type(part.inline_data.data))
            print("Data length:", len(part.inline_data.data))
except Exception as e:
    print("Error:", e)
