import { execSync } from 'child_process';

import { WebClient } from '@slack/web-api';

export class UpmergeHandler {

  public async checkUpmergeAndNotifiy() {
    console.log(execSync(`git config --global user.email ${process.env.GIT_USER_EMAIL}`).toString());
    console.log(execSync(`git config --global user.name ${process.env.GIT_USER}`).toString());
    const slackMessage = this.isUpmergeNeeded();
    await this.postToSlack(slackMessage);
  }

  isUpmergeNeeded(): string {
    const repo = execSync('git config --get remote.origin.url').toString().trim();
    let cliResult: string[] = []
    try {
      cliResult = execSync('cplace-cli flow --upmerge --release 5.17 --no-push --show-files').toString().split('\n')
      console.log('cliResult: ', cliResult);
    } catch (error) {
      return `There was an error running cplace-cli in repo ${repo}:\n\n${error}`;
    }
    const index = cliResult.findIndex(v => v.includes("have been merged"));
    const releaseThatNeedsUpmerge = cliResult[index - 1]?.split('release')[1]?.split('into')[0]?.trim().replace('\/', '');
    if (releaseThatNeedsUpmerge) {
      return `Please upmerge from release ${releaseThatNeedsUpmerge} in repo ${repo}`;
    }
    return '';
  }

  private async postToSlack(message: string) {
    if (message && message.length > 0) {
      const web = new WebClient(process.env.SLACK_TOKEN_UPMERGE);
      try {
        await web.chat.postMessage({
          channel: 'frontend-upmerge',
          text: message,
        });
        console.log(`Posted to Slack successfully ${message}`);
      } catch (error) {
        console.log(error);
      }
    }
  }
}
