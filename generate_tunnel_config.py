import os
import re

def generate_config():
    # 1. Parse Backend Localtunnel URL
    be_url = None
    if os.path.exists("localtunnel_be.txt"):
        try:
            with open("localtunnel_be.txt", "r", encoding="utf-8") as f:
                content = f.read()
            match = re.search(r"https://[^\s]+", content)
            if match:
                be_url = match.group(0).strip().rstrip('/')
                with open("backend_url.js", "w", encoding="utf-8") as f:
                    f.write(f'window.RTO_TUNNEL_BACKEND = "{be_url}";\n')
                print(f"[Tunnel Config] Success! Auto-configured backend URL: {be_url}")
        except Exception as e:
            print(f"[Tunnel Config] Error parsing backend tunnel log: {e}")
    
    if not be_url:
        try:
            with open("backend_url.js", "w", encoding="utf-8") as f:
                f.write("// Default backend tunnel config (empty in production)\nwindow.RTO_TUNNEL_BACKEND = null;\n")
            print("[Tunnel Config] Reset backend_url.js to production default (null).")
        except Exception as e:
            print(f"[Tunnel Config] Error resetting config: {e}")

    # 2. Parse Frontend Localtunnel URL for backend landing page link
    fe_url_file = os.path.join("backend", "tunnel_fe_url.txt")
    fe_url = None
    if os.path.exists("localtunnel_fe.txt"):
        try:
            with open("localtunnel_fe.txt", "r", encoding="utf-8") as f:
                content = f.read()
            match = re.search(r"https://[^\s]+", content)
            if match:
                fe_url = match.group(0).strip().rstrip('/')
                with open(fe_url_file, "w", encoding="utf-8") as f:
                    f.write(fe_url)
                print(f"[Tunnel Config] Success! Auto-configured frontend URL for backend landing page: {fe_url}")
        except Exception as e:
            print(f"[Tunnel Config] Error parsing frontend tunnel log: {e}")
            
    if not fe_url and os.path.exists(fe_url_file):
        try:
            os.remove(fe_url_file)
        except Exception:
            pass

if __name__ == "__main__":
    generate_config()
