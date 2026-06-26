---
name: docker-deploy
description: Build and optimize Docker images, write multi-stage Dockerfiles, debug container builds, and set up compose-based local and CI environments.
metadata:
  priority: 55
  promptSignals:
    phrases:
      - "dockerfile"
      - "docker image"
      - "docker compose"
      - "container build"
      - "multi-stage build"
      - "image size"
    minScore: 6
    noneOf: []
  pathPatterns:
    - "Dockerfile"
    - "docker-compose\\.ya?ml$"
---

# Docker & Deploy (example skill)

Sample skill. Replace with your project's container guidance.
