module.exports = function babelConfig(api) {
  const env = api.env();

  api.cache.using(() => env);

  const plugins = [
    '@babel/plugin-proposal-class-static-block',
    [
      '@babel/plugin-proposal-decorators',
      { version: '2023-01' },
    ],
    [
      '@babel/plugin-proposal-class-properties',
      { loose: false },
    ],
  ];

  if (env === 'build') {
    return {
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              esmodules: true,
            },
            modules: false,
          },
        ],
      ],
      plugins,
      assumptions: {
        setPublicClassFields: false,
      },
    };
  }

  return {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: {
            node: 'current',
          },
        },
      ],
      [
        '@babel/preset-react',
        {
          runtime: 'automatic',
        },
      ],
      [
        '@babel/preset-typescript',
        {
          allowDeclareFields: true,
        },
      ],
    ],
    plugins,
    assumptions: {
      setPublicClassFields: false,
    },
  };
};
