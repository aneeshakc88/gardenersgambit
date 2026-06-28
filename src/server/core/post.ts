import { reddit, context } from '@devvit/web/server';

export const createPost = async (title = 'gardenersgambit', asUser = false) => {
  return await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title,
    entry: 'default',
    ...(asUser ? { runAs: 'USER', userGeneratedContent: { text: title } } : {}),
  });
};
