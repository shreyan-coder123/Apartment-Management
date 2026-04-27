import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const localhostHosts = new Set(["localhost", "127.0.0.1"]);

const getAutoApiBase = () => `${window.location.protocol}//${window.location.hostname}:4000/api`;

const resolveApiBase = () => {
  const configured = import.meta.env.VITE_API_URL;

  if (!configured) {
    return getAutoApiBase();
  }

  try {
    const parsed = new URL(configured);
    const openedFromLocalhost = localhostHosts.has(window.location.hostname);
    const configuredForLocalhost = localhostHosts.has(parsed.hostname);

    if (!openedFromLocalhost && configuredForLocalhost) {
      return getAutoApiBase();
    }
  } catch {
    return configured;
  }

  return configured;
};

const API_BASE_RAW = resolveApiBase();
const API_BASE = API_BASE_RAW.endsWith("/")
  ? API_BASE_RAW.slice(0, -1)
  : API_BASE_RAW;
const SOCKET_BASE = API_BASE.replace(/\/api$/, "");

const SESSION_KEY = "apartment-app-session-token";

const billTypes = ["electricity", "water", "maintenance", "rent", "security"];

const apiRequest = async (path, options = {}) => {
  const { token, method = "GET", body } = options;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount || 0);

const formatDate = (value) => {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const StatusBadge = ({ status }) => (
  <span
    className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${
      status === "paid"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-amber-100 text-amber-800"
    }`}
  >
    {status.toUpperCase()}
  </span>
);

const App = () => {
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(null);

  const [dashboard, setDashboard] = useState(null);
  const [bills, setBills] = useState([]);
  const [messages, setMessages] = useState([]);
  const [residents, setResidents] = useState([]);

  const role = session?.user?.role;
  const token = session?.token;

  const residentsById = useMemo(() => {
    const mapped = {};
    residents.forEach((resident) => {
      mapped[resident.userId] = resident.name;
    });
    return mapped;
  }, [residents]);

  const loadData = useCallback(async () => {
    if (!token) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const requests = [
        apiRequest("/dashboard", { token }),
        apiRequest("/bills", { token }),
        apiRequest("/messages", { token }),
      ];

      if (role === "admin") {
        requests.push(apiRequest("/residents", { token }));
      }

      const [dashboardRes, billsRes, messagesRes, residentsRes] = await Promise.all(requests);
      setDashboard(dashboardRes);
      setBills(billsRes.bills || []);
      setMessages(messagesRes.messages || []);
      setResidents(residentsRes?.residents || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }, [role, token]);

  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = localStorage.getItem(SESSION_KEY);

      if (!storedToken) {
        setLoadingSession(false);
        return;
      }

      try {
        const restored = await apiRequest("/auth/me", { token: storedToken });
        setSession({
          token: storedToken,
          user: restored.user,
          apartment: restored.apartment,
        });
      } catch {
        localStorage.removeItem(SESSION_KEY);
      } finally {
        setLoadingSession(false);
      }
    };

    restoreSession();
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    loadData();
  }, [loadData, token]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const socket = io(SOCKET_BASE, {
      auth: { token },
      transports: ["websocket"],
    });

    const syncFromEvent = () => {
      setNotice("Live update received");
      loadData();
    };

    socket.on("resident:joined", syncFromEvent);
    socket.on("bill:new", syncFromEvent);
    socket.on("bill:created", syncFromEvent);
    socket.on("bill:updated", syncFromEvent);
    socket.on("bill:status-updated", syncFromEvent);
    socket.on("message:new", syncFromEvent);

    return () => {
      socket.disconnect();
    };
  }, [loadData, token]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timeoutId = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timeoutId);
  }, [notice]);

  const handleAuthSuccess = (authPayload) => {
    localStorage.setItem(SESSION_KEY, authPayload.token);
    setSession(authPayload);
    setError("");
    setNotice("Session ready");
  };

  const handleLogout = async () => {
    if (!token) {
      return;
    }

    try {
      await apiRequest("/auth/logout", { method: "POST", token });
    } catch {
      // Keep client logout resilient even if server fails.
    }

    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setDashboard(null);
    setBills([]);
    setMessages([]);
    setResidents([]);
    setError("");
    setNotice("");
  };

  if (loadingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-4 text-sm font-medium text-slate-700 shadow-sm">
          Loading session...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        onAuthSuccess={handleAuthSuccess}
        setError={setError}
        error={error}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
              Apartment Manager
            </h1>
            <p className="text-sm text-slate-600">
              {session.apartment.name} | Join code:{" "}
              <span className="font-bold text-slate-900">{session.apartment.joinCode}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
              {session.user.name} ({session.user.role})
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-5 sm:px-6">
        {notice && (
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        <SummaryStrip role={role} dashboard={dashboard} />

        {role === "admin" ? (
          <AdminDashboard
            busy={busy}
            token={token}
            residents={residents}
            bills={bills}
            messages={messages}
            residentsById={residentsById}
            onAfterMutation={loadData}
            setError={setError}
          />
        ) : (
          <ResidentDashboard
            token={token}
            bills={bills}
            messages={messages}
            setError={setError}
            onAfterMutation={loadData}
          />
        )}
      </main>
    </div>
  );
};

const AuthScreen = ({ onAuthSuccess, setBusy, setError, busy, error }) => {
  const [mode, setMode] = useState("create");
  const [createForm, setCreateForm] = useState({
    apartmentName: "",
    apartmentAddress: "",
    adminName: "",
  });
  const [joinForm, setJoinForm] = useState({
    residentName: "",
    joinCode: "",
  });

  const handleCreateApartment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await apiRequest("/auth/create-apartment", {
        method: "POST",
        body: createForm,
      });
      onAuthSuccess(response);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const handleJoinApartment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await apiRequest("/auth/join-apartment", {
        method: "POST",
        body: {
          ...joinForm,
          joinCode: joinForm.joinCode.toUpperCase(),
        },
      });
      onAuthSuccess(response);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Multi-User Apartment Management
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Create an apartment as admin or join one with a shared code from another device.
        </p>

        <div className="mt-6 flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
              mode === "create"
                ? "bg-slate-900 text-white"
                : "bg-transparent text-slate-600 hover:bg-slate-200"
            }`}
          >
            Create Apartment
          </button>
          <button
            type="button"
            onClick={() => setMode("join")}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
              mode === "join"
                ? "bg-slate-900 text-white"
                : "bg-transparent text-slate-600 hover:bg-slate-200"
            }`}
          >
            Join Apartment
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        {mode === "create" ? (
          <form onSubmit={handleCreateApartment} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-1">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-600">
                Admin Name
              </span>
              <input
                required
                value={createForm.adminName}
                onChange={(event) =>
                  setCreateForm((previous) => ({ ...previous, adminName: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                placeholder="Owner name"
              />
            </label>

            <label className="sm:col-span-1">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-600">
                Apartment Name
              </span>
              <input
                required
                value={createForm.apartmentName}
                onChange={(event) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    apartmentName: event.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                placeholder="Sunrise Apartments"
              />
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-600">
                Address (Optional)
              </span>
              <input
                value={createForm.apartmentAddress}
                onChange={(event) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    apartmentAddress: event.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                placeholder="Street, City"
              />
            </label>

            <button
              disabled={busy}
              type="submit"
              className="sm:col-span-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {busy ? "Creating..." : "Create Apartment"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoinApartment} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-1">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-600">
                Resident Name
              </span>
              <input
                required
                value={joinForm.residentName}
                onChange={(event) =>
                  setJoinForm((previous) => ({
                    ...previous,
                    residentName: event.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                placeholder="Resident name"
              />
            </label>

            <label className="sm:col-span-1">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-600">
                Join Code
              </span>
              <input
                required
                value={joinForm.joinCode}
                onChange={(event) =>
                  setJoinForm((previous) => ({ ...previous, joinCode: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm uppercase outline-none transition focus:border-slate-500"
                placeholder="AB12CD"
              />
            </label>

            <button
              disabled={busy}
              type="submit"
              className="sm:col-span-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {busy ? "Joining..." : "Join Apartment"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

const SummaryStrip = ({ role, dashboard }) => {
  const summary = dashboard?.summary || {};

  const items =
    role === "admin"
      ? [
          { label: "Residents", value: summary.totalResidents ?? 0 },
          { label: "Total Bills", value: summary.totalBills ?? 0 },
          { label: "Paid", value: summary.paidBills ?? 0 },
          { label: "Unpaid", value: summary.unpaidBills ?? 0 },
        ]
      : [
          { label: "Pending Bills", value: summary.pendingBills ?? 0 },
          { label: "Paid History", value: summary.paidBills ?? 0 },
          { label: "Messages", value: summary.totalMessages ?? 0 },
        ];

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">{item.label}</p>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{item.value}</p>
        </div>
      ))}
    </section>
  );
};

const AdminDashboard = ({
  token,
  residents,
  bills,
  messages,
  onAfterMutation,
  residentsById,
  setError,
}) => {
  const [billForm, setBillForm] = useState({
    residentId: "",
    type: billTypes[0],
    amount: "",
    dueDate: "",
    notes: "",
    paymentPhone: "",
    qrCode: "",
  });
  const [messageForm, setMessageForm] = useState({
    recipientId: "",
    content: "",
  });
  const [savingBill, setSavingBill] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    if (!residents.length) {
      return;
    }

    setBillForm((current) => (current.residentId ? current : { ...current, residentId: residents[0].userId }));
    setMessageForm((current) =>
      current.recipientId ? current : { ...current, recipientId: residents[0].userId }
    );
  }, [residents]);

  const createBill = async (event) => {
    event.preventDefault();
    setSavingBill(true);
    setError("");

    try {
      await apiRequest("/bills", {
        token,
        method: "POST",
        body: {
          ...billForm,
          amount: Number(billForm.amount),
          dueDate: new Date(`${billForm.dueDate}T00:00:00`).toISOString(),
        },
      });
      setBillForm((current) => ({
        ...current,
        amount: "",
        dueDate: "",
        notes: "",
      }));
      await onAfterMutation();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingBill(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    setSendingMessage(true);
    setError("");

    try {
      await apiRequest("/messages", {
        token,
        method: "POST",
        body: messageForm,
      });
      setMessageForm((previous) => ({ ...previous, content: "" }));
      await onAfterMutation();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
      <section className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Residents</h3>
          {!residents.length ? (
            <p className="mt-2 text-sm text-slate-600">
              No residents yet. Share the apartment join code to onboard them.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Joined</th>
                    <th className="py-2 pr-4">User ID</th>
                  </tr>
                </thead>
                <tbody>
                  {residents.map((resident) => (
                    <tr key={resident.userId} className="border-b border-slate-100">
                      <td className="py-2 pr-4 font-semibold text-slate-800">{resident.name}</td>
                      <td className="py-2 pr-4 text-slate-600">{formatDateTime(resident.joinedAt)}</td>
                      <td className="py-2 pr-4 text-xs text-slate-500">{resident.userId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Bills</h3>
          <div className="mt-3 grid gap-3">
            {bills.length === 0 && <p className="text-sm text-slate-600">No bills created yet.</p>}
            {bills.map((bill) => (
              <article
                key={bill.id}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">
                      {bill.type} | {residentsById[bill.residentId] || bill.residentId}
                    </p>
                    <p className="text-slate-600">Due: {formatDate(bill.dueDate)}</p>
                  </div>
                  <StatusBadge status={bill.status} />
                </div>
                <p className="mt-2 text-lg font-extrabold text-slate-900">{formatCurrency(bill.amount)}</p>
                {bill.notes && <p className="mt-1 text-slate-600">{bill.notes}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <form onSubmit={createBill} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Create Bill</h3>
          <div className="mt-3 grid gap-3">
            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Resident</span>
              <select
                required
                value={billForm.residentId}
                onChange={(event) =>
                  setBillForm((previous) => ({ ...previous, residentId: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {!residents.length && <option value="">No residents</option>}
                {residents.map((resident) => (
                  <option key={resident.userId} value={resident.userId}>
                    {resident.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Type</span>
              <select
                required
                value={billForm.type}
                onChange={(event) =>
                  setBillForm((previous) => ({ ...previous, type: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {billTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Amount</span>
              <input
                required
                type="number"
                min="1"
                step="0.01"
                value={billForm.amount}
                onChange={(event) =>
                  setBillForm((previous) => ({ ...previous, amount: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Due Date</span>
              <input
                required
                type="date"
                value={billForm.dueDate}
                onChange={(event) =>
                  setBillForm((previous) => ({ ...previous, dueDate: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Payment Phone</span>
              <input
                value={billForm.paymentPhone}
                onChange={(event) =>
                  setBillForm((previous) => ({
                    ...previous,
                    paymentPhone: event.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="+91..."
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">QR Code URL</span>
              <input
                value={billForm.qrCode}
                onChange={(event) =>
                  setBillForm((previous) => ({ ...previous, qrCode: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="https://... or data:image/..."
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Notes</span>
              <textarea
                rows="3"
                value={billForm.notes}
                onChange={(event) =>
                  setBillForm((previous) => ({ ...previous, notes: event.target.value }))
                }
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>

            <button
              disabled={savingBill || !residents.length}
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {savingBill ? "Saving..." : "Create Bill"}
            </button>
          </div>
        </form>

        <form onSubmit={sendMessage} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Send Personal Message</h3>
          <div className="mt-3 grid gap-3">
            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Recipient</span>
              <select
                required
                value={messageForm.recipientId}
                onChange={(event) =>
                  setMessageForm((previous) => ({ ...previous, recipientId: event.target.value }))
                }
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {!residents.length && <option value="">No residents</option>}
                {residents.map((resident) => (
                  <option key={resident.userId} value={resident.userId}>
                    {resident.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Message</span>
              <textarea
                required
                rows="3"
                value={messageForm.content}
                onChange={(event) =>
                  setMessageForm((previous) => ({ ...previous, content: event.target.value }))
                }
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>

            <button
              disabled={sendingMessage || !residents.length}
              type="submit"
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
            >
              {sendingMessage ? "Sending..." : "Send Message"}
            </button>
          </div>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Sent Messages</h3>
          <div className="mt-3 space-y-3">
            {!messages.length && <p className="text-sm text-slate-600">No messages sent yet.</p>}
            {messages.map((message) => (
              <article key={message.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="font-semibold text-slate-800">
                  To: {residentsById[message.recipientId] || message.recipientId}
                </p>
                <p className="mt-1 text-slate-700">{message.content}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(message.createdAt)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

const ResidentDashboard = ({ token, bills, messages, onAfterMutation, setError }) => {
  const [payingBillId, setPayingBillId] = useState("");

  const markAsPaid = async (billId) => {
    setPayingBillId(billId);
    setError("");

    try {
      await apiRequest(`/bills/${billId}/mark-paid`, {
        method: "PATCH",
        token,
      });
      await onAfterMutation();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPayingBillId("");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
      <section className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Your Bills</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {bills.length === 0 && <p className="text-sm text-slate-600">No bills yet.</p>}
            {bills.map((bill) => (
              <article key={bill.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">{bill.type}</p>
                    <p className="text-slate-600">Due: {formatDate(bill.dueDate)}</p>
                  </div>
                  <StatusBadge status={bill.status} />
                </div>

                <p className="mt-3 text-lg font-extrabold text-slate-900">{formatCurrency(bill.amount)}</p>
                {bill.notes && <p className="mt-1 text-slate-600">{bill.notes}</p>}

                {bill.paymentPhone && (
                  <p className="mt-2 text-xs font-semibold uppercase text-slate-500">
                    Pay to: <span className="normal-case text-slate-700">{bill.paymentPhone}</span>
                  </p>
                )}

                {bill.qrCode && (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
                    <img
                      src={bill.qrCode}
                      alt="Payment QR"
                      className="h-40 w-40 object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}

                <p className="mt-2 text-xs text-slate-500">Created: {formatDateTime(bill.createdAt)}</p>
                {bill.paidAt && (
                  <p className="mt-1 text-xs text-emerald-700">Paid at: {formatDateTime(bill.paidAt)}</p>
                )}

                {bill.status === "unpaid" && (
                  <button
                    type="button"
                    disabled={payingBillId === bill.id}
                    onClick={() => markAsPaid(bill.id)}
                    className="mt-3 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
                  >
                    {payingBillId === bill.id ? "Updating..." : "Mark as Paid"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Messages</h3>
          <div className="mt-3 space-y-3">
            {!messages.length && <p className="text-sm text-slate-600">No personal messages yet.</p>}
            {messages.map((message) => (
              <article key={message.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-800">{message.content}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(message.createdAt)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default App;
