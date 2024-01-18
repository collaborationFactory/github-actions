import { execSync } from 'child_process';

import { ChatPostMessageResponse, WebClient } from '@slack/web-api';

interface SlackPost {
  message: string;
  threadMessage?: string
}

export class UpmergeHandler {

  public async checkUpmergeAndNotifiy() {
    console.log(execSync(`git config --global user.email ${process.env.GIT_USER_EMAIL}`).toString());
    console.log(execSync(`git config --global user.name ${process.env.GIT_USER}`).toString());
    const slackMessage = this.isUpmergeNeeded();
    await this.postToSlack(slackMessage);
  }

  isUpmergeNeeded(): SlackPost {
    const repo = execSync('git config --get remote.origin.url').toString().trim();
    let cliResult: string[] = []
    try {
      cliResult = execSync('cplace-cli flow --upmerge --release 5.17 --no-push --show-files').toString().split('\n')
      console.log('cliResult: ', cliResult);
    } catch (error) {
      const linkToAction = `https://github.com/collaborationFactory/cplace-fe/actions/runs/${process.env.GITHUB_RUN_ID}`;
      return {
        message: `There was an error running cplace-cli in repo ${repo}:\n\n${linkToAction}`,
        threadMessage: error
      };
    }
    const index = cliResult.findIndex(v => v.includes("have been merged"));
    const releaseThatNeedsUpmerge = cliResult[index - 1]?.split('release')[1]?.split('into')[0]?.trim().replace('\/', '');
    if (releaseThatNeedsUpmerge) {
      return {'message': `Please upmerge from release ${releaseThatNeedsUpmerge} in repo ${repo}`};
    }
    return {'message': ''};
  }

  private async postToSlack(slackPost: SlackPost) {
    if (slackPost.message && slackPost.message.length > 0) {
      const web = new WebClient(process.env.SLACK_TOKEN_UPMERGE);
      try {
        const result: ChatPostMessageResponse = await web.chat.postMessage({
          channel: 'frontend-upmerge',
          text: slackPost.message
        });
        if (result.ts && slackPost.threadMessage && slackPost.threadMessage.length > 0) {
          const threadResult: ChatPostMessageResponse = await web.chat.postMessage({
            channel: 'frontend-upmerge',
            text: slackPost.threadMessage,
            thread_ts: result.ts,
          });
        }
        console.log(`Successfully posted to Slack\n\n ${slackPost.message} ${slackPost.threadMessage}`);
      } catch (error) {
        console.log(error);
      }
    }
  }
}
