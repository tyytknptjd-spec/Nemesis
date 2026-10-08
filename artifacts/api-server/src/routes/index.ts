import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nemesisRouter from "./nemesis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nemesisRouter);

export default router;
