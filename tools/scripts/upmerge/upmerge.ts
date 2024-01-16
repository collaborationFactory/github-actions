import { execSync } from 'child_process';

import { WebClient } from '@slack/web-api';

export async function checkUpmergeAndNotifiy() {
  const slackMessage = isUpmergeNeeded();
  await postToSlack(slackMessage);
}

export function isUpmergeNeeded(): string {
  const cliResult = execSync('cplace-cli flow --upmerge --release 5.17 --no-push --show-files').toString().split('\n')
  const index = cliResult.findIndex(v => v.includes("have been merged"));
  const releaseThatNeedsUpmerge = cliResult[index - 1]?.split('release')[1]?.split('into')[0]?.trim().replace('\/', '');
  if (releaseThatNeedsUpmerge) {
    return `Please upmerge from release ${releaseThatNeedsUpmerge}`;
  }
  return '';
}

export async function postToSlack(message: string) {
  if (message && message.length > 0) {
    const web = new WebClient(process.env.SLACK_TOKEN_UPMERGE);
    try {
      await web.chat.postMessage({
        channel: 'frontend-upmerge',
        text: message,
      });
      console.log('Message posted!');
    } catch (error) {
      console.log(error);
    }
  }
}

checkUpmergeAndNotifiy();
