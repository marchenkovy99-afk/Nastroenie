import { useState, type FormEvent } from 'react';
import { authError, supabase, verifyEmail } from './cloud';

type Method = 'password' | 'email' | 'register';

export function CloudSignIn() {
  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function selectMethod(next: Method) {
    setMethod(next);
    setPassword('');
    setToken('');
    setSentTo('');
    setError('');
  }

  async function attempt(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    const address = email.trim();
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        shouldCreateUser: method === 'register',
        emailRedirectTo: new URL(import.meta.env.BASE_URL, location.href).href,
      },
    });
    if (error) throw error;
    setSentTo(address);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void attempt(async () => {
      if (method === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error?.code === 'invalid_credentials') throw Error('Проверь почту и пароль. Если пароль не задан, войди по письму.');
        if (error) throw error;
        return;
      }
      if (sentTo) await verifyEmail(sentTo, token);
      else await sendEmail();
    });
  }

  return (
    <>
      <p className="detail-intro">Войди, чтобы синхронизировать записи между устройствами.</p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="cloud-email">Электронная почта</label>
        <input id="cloud-email" type="email" autoComplete="username" required value={email}
          readOnly={!!sentTo} onChange={event => setEmail(event.target.value)} />
        {method === 'password' && (
          <>
            <label className="field-label" htmlFor="cloud-password">Пароль</label>
            <input id="cloud-password" type="password" autoComplete="current-password" required value={password}
              onChange={event => setPassword(event.target.value)} />
          </>
        )}
        {sentTo && (
          <>
            <p className="small muted">Письмо отправлено. Открой ссылку или вставь сюда ссылку либо код из письма.</p>
            <label className="field-label" htmlFor="cloud-token">Код или ссылка из письма</label>
            <input id="cloud-token" autoComplete="one-time-code" required value={token}
              onChange={event => setToken(event.target.value)} />
          </>
        )}
        <button className="primary compact" disabled={busy || !email.trim() || (method === 'password' && !password) || (!!sentTo && !token.trim())}>
          {busy ? 'Подожди…' : sentTo || method === 'password' ? 'Войти' : method === 'register' ? 'Получить письмо для регистрации' : 'Получить письмо для входа'}
        </button>
        {sentTo && <button type="button" className="text-button full" disabled={busy} onClick={() => void attempt(sendEmail)}>Отправить письмо ещё раз</button>}
      </form>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {method === 'password' ? (
        <>
          <button className="text-button full" disabled={busy} onClick={() => selectMethod('email')}>Войти по письму</button>
          <button className="text-button full" disabled={busy} onClick={() => selectMethod('register')}>Создать аккаунт</button>
        </>
      ) : (
        <button className="text-button full" disabled={busy} onClick={() => selectMethod('password')}>Вернуться ко входу по паролю</button>
      )}
    </>
  );
}
