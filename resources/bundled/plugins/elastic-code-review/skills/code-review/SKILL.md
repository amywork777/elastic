---
name: code-review
description: Review GitHub pull requests with the Code Review tools - list what is waiting on the person, read a pull request's checks, diff and comment threads, show it to them in a tab, and post comments or reviews only when they ask.
---

# Code Review

The Code Review plugin reaches GitHub through the person's own GitHub CLI sign-in.

- `list_prs`: open pull requests, the session repository's or across GitHub when there is none. `filter: "review-requested"` is what waits on the person.
- `get_pr`, `get_pr_diff` (one file with `path`), `list_review_comments`: read before you judge. Read a large diff file by file.
- `show_pr`: put the pull request in front of the person, in a tab beside the chat. Do this when you start reviewing one, so they can follow along.
- `add_review_comment` (a line: `path`, `line`, `side`; or a reply: `in_reply_to`) and `submit_review` (`comment`, `approve`, `request_changes`) post under the person's account. Only when they asked you to post. Otherwise write your review in the chat and offer to post it.

When a tool says to sign in, tell the person to run `gh auth login` in a terminal; do not try to sign in for them.

A useful review names what the change does, what could break (with the file and line), what the tests cover and miss, and which checks fail and why.
