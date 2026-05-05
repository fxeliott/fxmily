/**
 * Conventional Commits enforcement.
 * Cf. https://www.conventionalcommits.org/
 *
 * Format attendu : `type(scope?): subject`
 * Types autorisés : feat, fix, chore, docs, refactor, perf, test, build, ci, revert, style.
 * Scope optionnel (ex: `auth`, `journal`, `j0`, `j1`).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Le scope est libre — on n'enforce pas une enum stricte (les jalons et
    // modules évoluent vite).
    'scope-empty': [0],
    // Subject en anglais, court, mode impératif.
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-max-length': [2, 'always', 100],
    'header-max-length': [2, 'always', 100],
    // Type obligatoire en lowercase.
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'docs',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'revert',
        'style',
      ],
    ],
  },
};
