#!/bin/sh -l

echo ">>> Executing pr validation check <<<"
echo ""
echo ""

export GITHUB_TOKEN=$INPUT_GITHUB_TOKEN
export REPOSITORY_NAME=$INPUT_REPOSITORY_NAME

PR_NUMBER=$(jq -r .pull_request.number "$GITHUB_EVENT_PATH")
PR_TITLE=$(jq -r .pull_request.title "$GITHUB_EVENT_PATH")
PR_DESCRIPTION=$(jq -r .pull_request.body "$GITHUB_EVENT_PATH")

LABELS=$(curl -s -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "X-GitHub-Api-Version: 2022-11-28" "https://api.github.com/repos/${REPOSITORY_NAME}/issues/${PR_NUMBER}/labels" | jq -r '.[].name')
ASSIGNEE=$(curl -s -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "X-GitHub-Api-Version: 2022-11-28" "https://api.github.com/repos/${REPOSITORY_NAME}/pulls/${PR_NUMBER}" | jq -r '.assignee.login')

if [[ " ${LABELS[@]} " =~ "PR: Ready to Merge" && -n "$ASSIGNEE" ]]; then
  echo "PR is labeled 'PR: Ready to Merge' and assigned to '$ASSIGNEE'."
else
  echo "PR must have the label 'PR: Ready to Merge' and be assigned to someone."
  exit 1
fi

if echo "$PR_TITLE" | grep -qE '^(PFM-TASK|PFM-ISSUE)-[0-9]+\s-\s.+$'; then
  echo "PR title format is correct."
else
  echo "PR title format is incorrect. It should match the specified format."
  exit 1
fi

if echo "$PR_DESCRIPTION" | grep -qP 'Resolves \[(PFM-(TASK|ISSUE))-[[:digit:]]+\]\(https:\/\/base\.cplace\.io.*?\)'; then
  echo "PR description link is correct."
else
  echo "PR description link is incorrect."
  exit 1
fi

if echo "$PR_DESCRIPTION" | grep -qP "\`changelog: .*?: \[(PFM-(TASK|ISSUE))-[[:digit:]]+\] .*?\[PR ${REPOSITORY_NAME}\#${PR_NUMBER}\]\`"; then
  echo "PR description changelog is correct."
else
  echo "PR description changelog is incorrect."
  exit 1
fi

if echo "$PR_DESCRIPTION" | grep -qP '\- \[x\] Created issue in Base if did not exist'; then
  echo "PR description created issue is correct."
else
  echo "PR description created issue is incorrect."
  exit 1
fi

if echo "$PR_DESCRIPTION" | grep -qP '\- \[x\] Formulated changelog according to \[guidelines\]'; then
  echo "PR description formulated changelog is correct."
else
  echo "PR description formulated changelog is incorrect."
  exit 1
fi

if echo "$PR_DESCRIPTION" | grep -qP '\- \[x\] Assigned myself as responsible for PR'; then
  echo "PR description assigned myself is correct."
else
  echo "PR description assigned myself is incorrect."
  exit 1
fi

if echo "$PR_DESCRIPTION" | grep -qP '\- \[x\] Assigned initial labels to PR and milestone specifying target release'; then
  echo "PR description assigned initial labels is correct."
else
  echo "PR description assigned initial labels is incorrect."
  exit 1
fi
