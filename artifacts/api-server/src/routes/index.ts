import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transitRouter from "./transit";
import entryRouter from "./entry";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entryRouter);
router.use(transitRouter);

export default router;
