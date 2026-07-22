import os
import re

def generate_config():
    if os.path.exists("localtunnel_be.txt"):
        try:
            with open("localtunnel_be.txt", "r", encoding="utf-8") as f:
                content = f.read()
            match = re.search(r"https://[^\s]+", content)
            if match:
                url = match.group(0).strip().rstrip('/')
                with open("backend_url.js", "w", encoding="utf-8") as f:
                    f.write(f'window.RTO_TUNNEL_BACKEND = "{url}";\n')
                print(f"[Tunnel Config] Success! Auto-configured backend URL: {url}")
                return
        except Exception as e:
            print(f"[Tunnel Config] Error parsing tunnel log: {e}")
    
    # If localtunnel file doesn't exist or url not found, reset backend_url.js to null default
    try:
        with open("backend_url.js", "w", encoding="utf-8") as f:
            f.write("// Default backend tunnel config (empty in production)\nwindow.RTO_TUNNEL_BACKEND = null;\n")
        print("[Tunnel Config] Reset backend_url.js to production default (null).")
    except Exception as e:
        print(f"[Tunnel Config] Error resetting config: {e}")

if __name__ == "__main__":
    generate_config()
