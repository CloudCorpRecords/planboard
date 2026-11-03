# Changelog

## 0.1.0 (2026-10-27)

- Initial release: 34 MCP tools and matching CLI subcommands
  over the Beck REST API — identity and workspaces (`whoami`,
  `list_workspaces`, `create_workspace`), API tokens
  (`list_api_tokens`, `create_api_token`, `revoke_api_token`),
  documents with etag-guarded writes (`list_documents`,
  `read_document`, `create_document`, `write_document`,
  `delete_document`, `list_document_versions`,
  `restore_document`), epics (`list_epics`, `get_epic`,
  `plan_it`, `get_epic_github`, `link_epic_github`), tasks
  (`list_tasks`, `get_task`, `get_task_context`,
  `recommend_task`, `start_task`, `finish_task`, `accept_task`,
  `reject_task`, `update_task`, `add_comment`,
  `list_comments`), progress (`log_progress`, `list_progress`)
  and decisions (`list_decisions`, `ask_decision`,
  `answer_decision`).
- Every request carries a bearer token from `BECK_API_TOKEN`
  plus per-process `X-Beck-Run` (and optional `X-Beck-Repo` /
  `X-Beck-Branch`) headers; upstream failures surface as
  `upstream error: HTTP <status> from beck-api` results.
