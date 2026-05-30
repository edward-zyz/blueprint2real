# Security Policy

## Supported Versions

Security fixes are provided for the latest released version.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub private vulnerability reporting when available for this repository.
If that is not available, contact the maintainer through the public profile
linked from the repository and include:

- A description of the issue.
- Steps to reproduce.
- Potential impact.
- Whether any secrets, credentials, or private project data may be involved.

We aim to acknowledge security reports within 7 days.

## Security Notes

blueprint2real is a local, file-based agent skill. It does not require hosted
services or external APIs. Treat target project state, receipts, and generated
boards as project artifacts and review them before publishing.
