# ToS Change Radar – starter dataset

Privacy Policy and Terms of Service history for 26 social media / app services
(Facebook, Instagram, Threads, TikTok, Reddit, Spotify, Snapchat, YouTube, LinkedIn, X, WhatsApp, Telegram, Bluesky and more),
July 2022 – October 2026.

## Files
- **policy_changes.csv** (2,186 rows) – one row per detected change: service, document_type, previous_date, change_date,
  word counts before/after, lines added/removed, and the added_text / removed_text. Start here – this is what you send to the LLM.
- **latest_policies.csv** (52 rows) – the current version of each document. Use this for the RAG chatbot.
- **policy_versions.csv** (2,270 rows) – the full text of every version, for building your own diffs.

## Source and licence
Built from the Platform Governance Archive dataset (PGA v2), collected with Open Terms Archive:
https://github.com/OpenTermsArchive/pga-versions
Licensed under the Open Database License (ODbL). Attribution required:
"Data from Open Terms Archive contributors / Platform Governance Archive."
Credit this in your project README.
