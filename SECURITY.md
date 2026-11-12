# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue. On the repository, go to
**Security → Report a vulnerability** (GitHub private vulnerability reporting) and describe what
you found, how to reproduce it and what it affects. We will answer there, and publish a fix and an
advisory once it is available.

## Scope

The seotools application (web, worker, CLIs) and the Docker image published as
`ghcr.io/vhxa/seotools`. Out of scope: vulnerabilities in a third-party dependency with no way to
exploit them through seotools (report those upstream), and a deployment's own configuration (reverse
proxy, firewall, exposed ports).

## Supported versions

Only the latest minor release receives security fixes. Update before reporting if you are behind:
[docs/updating.md](docs/updating.md).

## Rewards

This is a volunteer open source project: there is no bug bounty.
