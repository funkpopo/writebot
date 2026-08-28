const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const devCerts = require("office-addin-dev-certs");

const urlDev = "https://localhost:53000/";
const urlProd = "https://localhost:53000/";

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const config = {
    devtool: dev ? "inline-source-map" : false,
    entry: {
      taskpane: "./src/taskpane/taskpane.tsx",
      commands: "./src/commands/commands.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].bundle.js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                "@babel/preset-env",
                ["@babel/preset-react", { runtime: "automatic" }],
                "@babel/preset-typescript",
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico)$/,
          type: "asset/resource",
          generator: {
            filename: "assets/[name][ext]",
          },
        },
      ],
    },
    optimization: {
      splitChunks: {
        cacheGroups: {
          // 将第三方依赖拆为 vendor chunk，提升 add-in 首屏缓存命中
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: "vendor",
            chunks: "all",
            priority: -10,
          },
        },
      },
    },
    plugins: [
      // dev 模式下随构建做类型检查（生产构建仍靠 tsc --noEmit / CI 把关）
      ...(dev ? [new ForkTsCheckerWebpackPlugin({ async: false })] : []),
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"],
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["commands"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets",
            to: "assets",
            globOptions: {
              ignore: ["**/winsw/**"],
            },
          },
          {
            from: "manifest.xml",
            to: "manifest.xml",
          },
          {
            // 本地托管 office.js 及其运行时文件，避免依赖微软 CDN
            from: "node_modules/@microsoft/office-js/dist",
            to: "office-js",
          },
        ],
      }),
    ],
    devServer: {
      static: {
        directory: path.join(__dirname, "dist"),
      },
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      server: {
        type: "https",
        options: env?.WEBPACK_BUILD || !dev ? {} : await getHttpsOptions(),
      },
      port: 53000,
      hot: true,
    },
  };

  return config;
};
