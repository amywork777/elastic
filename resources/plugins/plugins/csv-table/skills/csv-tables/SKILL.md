---
name: csv-tables
description: Show tabular data to the person as a sortable table with the tables MCP server's show_table tool, instead of pasting a large table into the chat.
---

# Showing tables

When you have more than a handful of rows to show, call `show_table` (from the
`tables` MCP server) instead of writing a Markdown table:

- `path`: a `.csv` or `.tsv` file in the session's folder, or
- `csv`: the CSV text itself (first row is the header).

The table opens in a tab beside the chat, where the person can sort and filter
it. The tool's text result tells you the column names and row count, so you can
refer to them in your answer.
