import { UpmergeHandler } from "./upmerge";

new UpmergeHandler().checkUpmergeAndNotifiy().then(r => console.log('finished upmerge workflow'));
