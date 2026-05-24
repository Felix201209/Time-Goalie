# Rescue Policy

Homework Goalie can detect score-risky homework and prepare rescue packets, but it must not silently submit graded work.

Allowed by default:

- Scan ManageBac and Homework Vault.
- Classify risk and send Bark reminders.
- Summarize task requirements.
- Search local notes for progress signals.
- Generate a rescue packet and draft minimum deliverables.
- Prepare files or upload-ready text for Felix to review.

Submission rules:

- Graded homework: submit only after Felix confirms the exact assignment and artifact.
- Existing Felix-authored artifact: can be uploaded after Felix says it is the intended final.
- Administrative non-graded form: may be auto-submitted only when explicitly allowlisted.
- Never export ManageBac cookies to the Pi.

Rescue trigger:

- due within 6 hours,
- not submitted,
- big work signal is present,
- no substantial local draft is detected.
