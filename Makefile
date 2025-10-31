.PHONY: install run deploy help

# Default target
help:
	@echo "Available commands:"
	@echo "  make install  - Install npm dependencies"
	@echo "  make run      - Run the development server"
	@echo "  make deploy  - Deploy to Fly.io"

# Install npm dependencies
install:
	cd server && npm install

# Run the development server
run:
	cd server && npm start

# Deploy to Fly.io
deploy:
	flyctl deploy

