---
name: t3-templates
description: >-
  Saved T3 prompt templates with {vars}. Use for "run template <name>", "list
  templates", "save this as a template", "use my <name> template on <project>",
  "edit my <name> template".
---
Follow @t3-tots-rules. Run only the template the user names.

Templates live in `<tools folder>/templates.md`. Each template is one `## <name>` section with `project:`, `model:`, `effort:`, `status: suggested|active` and a fenced prompt that uses {vars}.

- Run: fuzzy-match the name and fill the {vars} from the message. Ask for any that are missing. Project, model or effort in the message override the template. Write the filled prompt to a file (t3-tots-rules "Sending into threads") and send it with @t3-new-thread, with `--title '<template>: <short>'`. Reply with the thread title and id. If the template was `suggested` and the run went fine, ask whether to mark it `active`.
- List: name, purpose, model and status.
- Save: turn the given prompt, or a named thread's first prompt, into a template with {vars}. Show it and write it after an OK.
- Suggest: when the user sends the same kind of prompt 3 or more times, offer a template with `status: suggested`.
- Edit or remove a template only when the user asks.
