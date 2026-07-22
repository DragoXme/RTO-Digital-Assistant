import os
import google.generativeai as genai

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    key_path = os.path.join(os.path.dirname(__file__), "api_key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            GEMINI_API_KEY = f.read().strip()
genai.configure(api_key=GEMINI_API_KEY, transport='rest')

model_name = "models/gemini-3.5-flash"

try:
    print(f"Testing generate_content on {model_name}...")
    
    config = {
        "response_modalities": ["AUDIO"]
    }
    
    model = genai.GenerativeModel(model_name=model_name)
    response = model.generate_content(
        "Say hello in a friendly voice.",
        generation_config=config
    )
    print("\n--- RAW RESPONSE ---")
    print(response)
    print("\n--- RAW PARTS ---")
    for i, part in enumerate(response.candidates[0].content.parts):
        print(f"\nPart {i}:")
        print("Type:", type(part))
        # Print string representation of the protobuf object
        print("String representation:")
        print(part)
except Exception as e:
    print("Error:", e)
