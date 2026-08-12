import { z } from "zod";

export const loginFormSchema = z
  .object({
    account: z.string().trim().min(1, "请输入手机号或账号").max(120),
    password: z.string().min(1, "请输入密码").max(200),
    rememberAccount: z.boolean()
  })
  .strict();

export type LoginFormValues = z.infer<typeof loginFormSchema>;
