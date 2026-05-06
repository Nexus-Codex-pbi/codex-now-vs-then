# Security Document – Codex Now vs Then

## Overview
This document describes the security characteristics of the **Codex Now vs Then** Power BI custom visual. It confirms compliance with Microsoft's security and certification requirements.

## 1. External Network Access
**The visual does not make any external network calls.**
- No HTTP/HTTPS requests
- No WebSockets
- No external APIs
- No remote JSON, images, fonts, or scripts

All resources are bundled within the `.pbiviz` package.

## 2. Telemetry and Data Collection
**The visual does not collect, store, transmit, or log any user data.**
- No telemetry
- No analytics
- No usage tracking
- No cookies or local storage

## 3. Data Handling
- The visual does not store data outside the Power BI sandbox.
- The visual does not persist data to disk.
- The visual does not send data to external systems.
- All data stays within the Power BI host environment.

## 4. Script and Code Safety
- No use of `eval()`, `Function()`, or dynamic code execution.
- No injection of external scripts or styles.
- No DOM escape or manipulation outside the visual container.

## 5. Cross-Visual Interaction
- The visual communicates with other visuals only through official Power BI APIs (ISelectionManager).
- No custom messaging or cross-iframe communication.

## 6. Dependencies
- No external libraries loaded at runtime.
- All JS/CSS/SVG assets bundled locally.
- No external fonts.

## 7. Permissions
The visual does not request elevated permissions.

## 8. Summary
**Codex Now vs Then** is sandbox-compliant, contains no external dependencies, performs no external communication, and adheres to all Microsoft Power BI security requirements.