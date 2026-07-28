interface FeedDisplayInput {
  hasProxy: boolean;
  postCount: number;
  nextCursor: string | null;
  hasInitialLoaded: boolean;
}

export function getInstagramFeedDisplayState({
  hasProxy,
  postCount,
  nextCursor,
  hasInitialLoaded,
}: FeedDisplayInput) {
  const showRealPosts = hasProxy && postCount > 0;
  return {
    showRealPosts,
    showPlaceholder:
      !showRealPosts && nextCursor === null && (!hasProxy || hasInitialLoaded),
    showPagination: showRealPosts || nextCursor !== null,
  };
}
