# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private report instead:
**Security › Report a vulnerability** on [the repository](https://github.com/Clovis500c/legato/security/advisories/new).

Say what you found, how to reproduce it and which version it affects (Settings › About). You will get an answer as soon
as the author can read it; Legato is a personal project, so there is no fixed delay.

## What matters most here

Legato has no server of ours, so the things worth protecting are on your PC:

- sign-ins, keys and the Sync Mode key, kept in the Windows Credential Manager;
- the library and settings, kept in a local database;
- what Sync Mode, the phone remote and the device pairing send over your network;
- what a third-party plugin can reach (its permissions are checked in Rust, never in the plugin);
- the update path: updates are signed, and the app checks the signature before it installs one.

What leaves the PC, host by host, is listed in the app (Settings › Privacy) and on the
[website](https://clovis500c.github.io/legato/#privacy).

## Supported versions

Only the newest Stable and the newest Beta. A fix ships as a new version, which the app installs by itself between two
songs.
