import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import type { Request, Response, NextFunction } from "express";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set("trust proxy", 1);
app.use(cors({ origin: false }));
app.use(express.json({limit:"16kb"}));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((err:unknown,req:Request,res:Response,_next:NextFunction) => {
  req.log.error({error:err instanceof Error?err.name:"Error"},"Request failed");
  res.status(500).json({error:"Transtop could not complete this request. Please try again."});
});

export default app;
