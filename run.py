import os
import sys
import subprocess
import time
import traceback
import signal
import socket

# Configuration
BACKEND_DIR = "backend"
FRONTEND_DIR = "frontend"

def find_available_port(host: str, preferred_port: int, max_tries: int = 20) -> int:
    for port in range(preferred_port, preferred_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No available port found from {preferred_port} to {preferred_port + max_tries - 1}")

def main():
    backend_proc = None
    frontend_proc = None
    
    try:
        # Get absolute paths
        root_dir = os.path.dirname(os.path.abspath(__file__))
        backend_path = os.path.join(root_dir, BACKEND_DIR)
        frontend_path = os.path.join(root_dir, FRONTEND_DIR)

        print(f"Root Directory: {root_dir}")

        # 1. Setup Environment
        print("Initializing environment...")
        env = os.environ.copy()
        
        # Critical for avoiding conflicts with user site-packages
        env["PYTHONNOUSERSITE"] = "1"
        # Prevent proxy issues with local LLM
        env["NO_PROXY"] = "localhost,127.0.0.1,::1"
        
        # Set default admin password if not set
        if "ADMIN_PASSWORD" not in env:
            print("ADMIN_PASSWORD not set. Using default: 123456")
            env["ADMIN_PASSWORD"] = "123456"
            # Force reset to ensure the DB matches the default password
            env["ADMIN_RESET_PASSWORD"] = "1"

        if "EMBEDDINGS_DEVICE" not in env:
            try:
                import torch
                cuda_ok = bool(torch.cuda.is_available())
                if cuda_ok:
                    name = ""
                    try:
                        name = torch.cuda.get_device_name(0)
                    except Exception:
                        name = ""
                    env["EMBEDDINGS_DEVICE"] = "cuda"
                    print(f"CUDA detected. EMBEDDINGS_DEVICE=cuda{f' ({name})' if name else ''}")
                else:
                    env["EMBEDDINGS_DEVICE"] = "cpu"
                    print("CUDA not detected. EMBEDDINGS_DEVICE=cpu")
            except Exception:
                env["EMBEDDINGS_DEVICE"] = "auto"
                print("Torch not available. EMBEDDINGS_DEVICE=auto")

        if (env.get("EMBEDDINGS_DEVICE") or "").strip().lower() != "cuda":
            if "RERANK_TOP_K" not in env:
                env["RERANK_TOP_K"] = "4"
                print("CPU 模式：已设置 RERANK_TOP_K=4 以降低重排耗时（可自行覆盖）")

        # 2. Start Backend
        if not os.path.exists(backend_path):
            raise FileNotFoundError(f"Backend directory not found: {backend_path}")
            
        print(f"Starting Backend in {backend_path}...")
        backend_cmd = [sys.executable, "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"]

        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
        
        backend_proc = subprocess.Popen(
            backend_cmd,
            cwd=backend_path,
            env=env,
            shell=False,
            creationflags=creationflags,
        )

        # 3. Start Frontend
        if not os.path.exists(frontend_path):
            fallback_path = os.path.join(root_dir, "fro", "my-app")
            if os.path.exists(fallback_path):
                frontend_path = fallback_path
            else:
                raise FileNotFoundError(f"Frontend directory not found: {frontend_path}")
            
        print(f"Starting Frontend in {frontend_path}...")
        npm_cmd = "npm"
        if os.name == "nt":
            npm_cmd = "npm.cmd"
            
        package_json_path = os.path.join(frontend_path, "package.json")
        frontend_port = 5173
        if os.path.exists(package_json_path):
            frontend_port = find_available_port("0.0.0.0", 5173)
            if frontend_port != 5173:
                print(f"Port 5173 is in use, fallback to {frontend_port}")
            frontend_cmd = [
                npm_cmd, "exec", "--", "next", "dev",
                "--webpack",
                "-H", "0.0.0.0",
                "-p", str(frontend_port),
            ]
        else:
            my_app_path = os.path.join(frontend_path, "my-app")
            if os.path.exists(os.path.join(my_app_path, "package.json")):
                frontend_path = my_app_path
                frontend_cmd = [npm_cmd, "run", "dev"]
            else:
                raise FileNotFoundError(f"No package.json found in {frontend_path} or its subdirectories")
        
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=frontend_path,
            env=env,
            shell=False,
            creationflags=creationflags,
        )

        print("\n" + "="*50)
        print("AI Assistant Services Started Successfully!")
        print("Backend: http://localhost:8000")
        if os.path.basename(frontend_path) == "frontend":
            print(f"Frontend: http://localhost:{frontend_port}")
        else:
            print("Frontend: check console for actual port")
        print("="*50 + "\n")
        print("Press Ctrl+C to stop all services.")

        # 4. Monitor Processes
        while True:
            time.sleep(1)
            if backend_proc.poll() is not None:
                print(f"Backend process exited unexpectedly with code {backend_proc.returncode}.")
                break
            if frontend_proc.poll() is not None:
                print(f"Frontend process exited unexpectedly with code {frontend_proc.returncode}.")
                break

    except KeyboardInterrupt:
        print("\nStopping services (KeyboardInterrupt)...")
    except Exception as e:
        print(f"\nError occurred: {e}")
        traceback.print_exc()
    finally:
        print("Cleaning up...")
        
        # Terminate Backend
        if backend_proc and backend_proc.poll() is None:
            print("Terminating Backend...")
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(backend_proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                backend_proc.terminate()
                try:
                    backend_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    backend_proc.kill()
        
        # Terminate Frontend
        if frontend_proc and frontend_proc.poll() is None:
            print("Terminating Frontend...")
            if os.name == "nt":
                # On Windows, npm spawns node, terminate might only kill npm wrapper.
                # Use taskkill to kill the process tree.
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(frontend_proc.pid)], 
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                frontend_proc.terminate()
                try:
                    frontend_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    frontend_proc.kill()
            
        print("Stopped.")
        
        # Pause if error occurred to let user see the message
        if sys.exc_info()[0] is not None and not isinstance(sys.exc_info()[1], KeyboardInterrupt):
             input("Press Enter to exit...")

if __name__ == "__main__":
    main()
