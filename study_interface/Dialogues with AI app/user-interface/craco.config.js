module.exports = {
    webpack: {
      configure: (webpackConfig) => {
        webpackConfig.module.rules.push({
          test: /\.csv$/,
          loader: 'csv-loader',
          options: {
            dynamicTyping: true,
            header: true,
            skipEmptyLines: true
          }
        });
        return webpackConfig;
      }
    }
  };