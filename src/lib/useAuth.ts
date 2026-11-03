import { useCallback, useEffect, useState } from "react";

import { getSupabase, isSupabaseConfigured, signInWithEmail, signOut, signUpWithEmail } from "./supabase";

export type AuthState = {
  ready: boolean;
  configured: boolean;
  userId: string | null;
  email: string | null;
  /** 注册成功但需要邮件确认时为 true —— 此时没有 session，必须提示用户去收信。 */
  pendingConfirm: boolean;
};

const supabaseAuth = () => getSupabase().auth;

/**
 * Supabase 的错误是英文原文，直接铺在中文界面里很突兀。
 * 只翻译确定含义的几条，其余原样透出，避免把未知错误说错。
 */
function humanizeAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "邮箱或密码不对，再试一次";
  if (text.includes("email not confirmed")) return "邮箱还没确认，去收件箱点一下确认链接";
  if (text.includes("user already registered")) return "这个邮箱注册过了，直接登录就行";
  if (text.includes("password should be at least")) return "密码至少 6 位";
  if (text.includes("unable to validate email address")) return "邮箱格式看起来不对";
  if (text.includes("email address not authorized"))
    return "这个邮箱不在允许范围，换一个或用项目管理员的邮箱";
  if (text.includes("rate limit") || text.includes("for security purposes"))
    return "请求太频繁，等一分钟再试";
  return message;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    ready: !isSupabaseConfigured,
    configured: isSupabaseConfigured,
    userId: null,
    email: null,
    pendingConfirm: false,
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    supabaseAuth()
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          ready: true,
          userId: data.session?.user.id ?? null,
          email: data.session?.user.email ?? null,
        }));
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, ready: true }));
      });

    const { data } = supabaseAuth().onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState((current) => ({
        ...current,
        ready: true,
        userId: session?.user.id ?? null,
        email: session?.user.email ?? null,
        pendingConfirm: session ? false : current.pendingConfirm,
      }));
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await signInWithEmail(email.trim(), password);
    return error ? humanizeAuthError(error.message) : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await signUpWithEmail(email.trim(), password);
    if (error) return { error: humanizeAuthError(error.message), needsConfirm: false };
    // 仅当项目的 Confirm email 为 ON 时会出现：signUp 只返回 user、不返回 session，
    // 用户得先去点邮件里的链接。关掉该开关后这条只是兜底。
    const needsConfirm = !data.session;
    if (needsConfirm) setState((current) => ({ ...current, pendingConfirm: true }));
    return { error: null, needsConfirm };
  }, []);

  const signOutNow = useCallback(async () => {
    await signOut();
    setState((current) => ({ ...current, userId: null, email: null, pendingConfirm: false }));
  }, []);

  return { ...state, signIn, signUp, signOut: signOutNow };
}
