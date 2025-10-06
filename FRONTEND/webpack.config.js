// FRONTEND/webpack.config.js
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  mode: isProd ? 'production' : 'development',
  entry: path.resolve(__dirname, 'src', 'index.js'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    assetModuleFilename: 'assets/[name][ext][query]',
    publicPath: '/',   // importante para SPA
    clean: true
  },
  target: 'web',
  devtool: isProd ? false : 'source-map',
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: { presets: ['@babel/preset-env', '@babel/preset-react'] }
        }
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader']
      },
      {
        test: /\.(png|jpe?g|gif|svg|webp|ico)$/i,
        type: 'asset/resource'
      },
      {
        test: /\.(ttf|otf|woff2?|eot)$/i,
        type: 'asset/resource'
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    alias: {
      crypto: path.resolve(__dirname, 'crypto-polyfill.js'),
      electron: path.resolve(__dirname, 'electron-polyfills.js')
    },
    fallback: { fs: false, path: false, os: false }
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'index.html'),
      inject: 'body'
    }),
    new MiniCssExtractPlugin({ filename: 'output.css' }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'assets', to: 'assets', noErrorOnMissing: true }]
    })
  ],
  devServer: {
    historyApiFallback: true,
    hot: true,
    port: 5173
  }
};
