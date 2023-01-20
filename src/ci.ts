interface Provider {
  matcher(): boolean;
  name: string;
  ci: CI;
}

interface CI {
  repo: string;
  refName: string;
  sha: string;
  user: string;
}

/**
 * https://docs.github.com/en/actions/learn-github-actions/environment-variables
 */
const GITHUB = {
  matcher: () => !!process.env['GITHUB_ACTIONS'],
  name: 'github',
  ci: {
    repo: process.env.GITHUB_REPOSITORY ?? '',
    refName: process.env.GITHUB_REF_NAME ?? '',
    sha: process.env.GITHUB_SHA ?? '',
    user: process.env.GITHUB_ACTOR ?? '',
  },
};

/**
 * https://docs.gitlab.com/ee/ci/variables/predefined_variables.html
 */
const GITLAB = {
  matcher: () => !!process.env['GITLAB_CI'],
  name: 'gitlab',
  ci: {
    repo: process.env.CI_PROJECT_PATH ?? '',
    refName: process.env.CI_COMMIT_REF_NAME ?? '',
    sha: process.env.CI_COMMIT_SHA ?? '',
    user: process.env.GITLAB_USER_LOGIN ?? '',
  },
};

const DEFAULT = {
  matcher: () => true,
  name: 'custom',
  ci: {
    repo: '',
    refName: '',
    sha: '',
    user: '',
  },
};

const providers : Provider[] = [
  GITHUB,
  GITLAB,
];

const provider = providers.find((p) => p.matcher()) || DEFAULT;

export const CI = provider.ci;
