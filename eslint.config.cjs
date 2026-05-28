module.exports = [
  {
    ignores: [
      "node_modules/**",
      "data/**",
    ],
  },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // Keep lint focused on parse/syntax failures for now.
    },
  },
];
