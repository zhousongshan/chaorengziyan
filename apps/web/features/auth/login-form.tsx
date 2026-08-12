"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Eye,
  EyeOff,
  FileImage,
  ImageIcon,
  LayoutGrid,
  LockKeyhole,
  UserRound
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { loginFormSchema, type LoginFormValues } from "@/features/auth/login.schema";
import { cn } from "@/lib/utils";

const carouselSlides = [
  { src: "/login/rabbit-hero.png", alt: "毛绒兔商品场景图" },
  { src: "/login/carousel-fairy-tale.png", alt: "梦幻童话商品营销场景图" },
  { src: "/login/carousel-diffuser.png", alt: "香氛产品营销海报" }
] as const;

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [submitMessage, setSubmitMessage] = useState("");
  const [isReady, setIsReady] = useState(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      account: "",
      password: "",
      rememberAccount: false
    }
  });

  useEffect(() => {
    const rememberedAccount = window.localStorage.getItem("chaoren.remembered-account");
    if (rememberedAccount) {
      form.setValue("account", rememberedAccount);
      form.setValue("rememberAccount", true);
    }
    setIsReady(true);
  }, [form]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % carouselSlides.length);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitMessage("");
    const response = await fetch("/api/auth/development-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: values.account, password: values.password })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setSubmitMessage(payload?.message ?? "暂时无法登录，请稍后重试");
      return;
    }

    if (values.rememberAccount) {
      window.localStorage.setItem("chaoren.remembered-account", values.account);
    } else {
      window.localStorage.removeItem("chaoren.remembered-account");
    }
    setSubmitMessage("登录成功，正在进入平台…");
    router.replace("/create");
    router.refresh();
  });

  return (
    <main className="login-canvas">
      <a className="login-brand" href="/login" aria-label="超韧AI登录页">
        <Image src="/brand/chaoren-logo.png" alt="超韧AI" width={52} height={52} priority />
        <strong>超韧AI</strong>
      </a>

      <div className="login-stage">
        <section className="login-showcase" aria-label="平台能力介绍">
          <div>
            <h1>
              让每件商品
              <span>拥有更好的展示方式</span>
            </h1>
            <p>AI生成主图、详情图、营销素材，一站式电商创作平台</p>
          </div>

          <div className="login-carousel-shell">
            <div className="login-carousel">
              {carouselSlides.map((slide, index) => (
                <Image
                  className={cn("login-slide", index === activeSlide && "is-active")}
                  key={slide.src}
                  src={slide.src}
                  alt={slide.alt}
                  fill
                  sizes="(max-width: 960px) 0px, 45vw"
                  priority={index === 0}
                />
              ))}
            </div>
            <div className="login-dots" aria-label="案例轮播">
              {carouselSlides.map((slide, index) => (
                <button
                  className={cn("login-dot", index === activeSlide && "is-active")}
                  key={slide.src}
                  type="button"
                  aria-label={`查看案例 ${index + 1}`}
                  aria-pressed={index === activeSlide}
                  onClick={() => setActiveSlide(index)}
                />
              ))}
            </div>
          </div>

          <div className="login-features">
            <span>
              <FileImage />
              主图生成<small>突出卖点，吸引点击</small>
            </span>
            <span>
              <LayoutGrid />
              详情图生成<small>精美排版，清晰传达</small>
            </span>
            <span>
              <ImageIcon />
              营销海报生成<small>创意海报，提升转化</small>
            </span>
          </div>
        </section>

        <section className="login-card" aria-label="账号登录">
          <header>
            <h2>
              <span>超韧AI</span>欢迎您
            </h2>
            <p>电商智能创作平台</p>
          </header>

          <form onSubmit={onSubmit} noValidate>
            <label className="login-field">
              <UserRound aria-hidden="true" />
              <input
                autoComplete="username"
                placeholder="请输入手机号/账号"
                {...form.register("account")}
              />
            </label>
            <FieldError message={form.formState.errors.account?.message} />

            <label className="login-field">
              <LockKeyhole aria-hidden="true" />
              <input
                autoComplete="current-password"
                type={showPassword ? "text" : "password"}
                placeholder="请输入密码"
                {...form.register("password")}
              />
              <button
                type="button"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </label>
            <FieldError message={form.formState.errors.password?.message} />

            <label className="remember-account">
              <input type="checkbox" {...form.register("rememberAccount")} />
              <span className="login-checkmark" aria-hidden="true" />
              <span>记住账号</span>
            </label>

            <Button
              className="login-submit mt-7 w-full"
              size="lg"
              type="submit"
              disabled={!isReady || form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "正在登录…" : "立即登录"}
            </Button>
            <p
              className={cn(
                "mt-4 min-h-5 text-center text-sm",
                submitMessage.startsWith("登录成功") ? "text-emerald-600" : "text-red-600"
              )}
              role="status"
            >
              {submitMessage}
            </p>
          </form>
        </section>
        <p className="login-copyright">© 2026超韧AI</p>
      </div>
    </main>
  );
}

function FieldError({ message }: Readonly<{ message: string | undefined }>) {
  return <p className="login-error">{message ?? "\u00a0"}</p>;
}
