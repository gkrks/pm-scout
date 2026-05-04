.PHONY: fit fit-node fit-python

# Start both the Node web server and Python bullet selector side by side.
# Ctrl-C kills both. Requires both runtimes available.
fit:
	@echo "Starting Python bullet selector on :8001..."
	@cd ats_bullet_selector && uv run uvicorn server:app --host 127.0.0.1 --port 8001 &
	@sleep 2
	@echo "Starting Node fit server on :3847..."
	@npx ts-node src/fit/server.ts

# Start just the Node web server (port 3847)
fit-node:
	npx ts-node src/fit/server.ts

# Start just the Python bullet selector (port 8001)
fit-python:
	cd ats_bullet_selector && uv run uvicorn server:app --host 127.0.0.1 --port 8001
