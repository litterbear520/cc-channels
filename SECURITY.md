# Security

A Channel hands messages from an instant-messaging Platform to an agent that has the permissions of your Claude Code session. A way for someone who is not on the allowlist to reach the session, to read the stored credentials, or to have a file from outside the inbox sent out is a vulnerability, and we want to hear about it.

## Reporting

Report it privately through [GitHub's vulnerability reporting](https://github.com/litterbear520/cc-channels/security/advisories/new). Please do not open a public issue for it.

Say which plugin and version, what you did, and what happened. Leave real AppSecrets, access tokens, and Sender IDs out of the report.

## What is in scope

- Getting past the access policy, the allowlist, or a group's settings.
- A message from the Platform changing access, or being taken as the answer to a permission prompt it should not answer.
- Credentials or access tokens reaching a log, a message, or Claude's context.
- Reading or sending a file the plugin's documentation says it will not.

Instructions hidden in a message that Claude then follows are a risk of every Channel, and the reason to pair only people you trust. Report one when the plugin itself made it possible, for example by letting text from a Sender break out of the `<channel>` tag.

## Supported versions

The latest commit on `main`.
