const config = window.CONTACTS_CONFIG || {};
const page = document.body.dataset.page;
const avatarColors = [
  ["#f1e4df", "#842d16"],
  ["#e6e6e6", "#595959"],
  ["#f6e8e3", "#842d16"],
  ["#e8e8e8", "#666"],
  ["#efe5e1", "#5f200f"]
];

const authError = document.querySelector("#auth-error");
const authNotice = document.querySelector("#auth-notice");
const pageError = document.querySelector("#page-error");
const pageNotice = document.querySelector("#page-notice");
const accountEmail = document.querySelector("#account-email");
let supabase;
let currentUser;
let currentUserName = "";
let contacts = [];
let callLogs = [];
let expandedContactIds = new Set();
let callNoteDrafts = new Map();

function show(element, message) {
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}

function hide(element) {
  if (!element) return;
  element.textContent = "";
  element.hidden = true;
}

function showAuthError(message) {
  hide(authNotice);
  show(authError, message);
}

function showAuthNotice(message) {
  hide(authError);
  show(authNotice, message);
}

function showPageError(message) {
  hide(pageNotice);
  show(pageError, message);
}

function showPageNotice(message) {
  hide(pageError);
  show(pageNotice, message);
}

function normalize(value) {
  return value.toLocaleLowerCase("pt-PT").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function authEmailForName(name) {
  const username = normalize(name.trim().replace(/\s+/g, " "))
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (!username || username.length > 64) return null;
  return username + "@members.invalid";
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("pt-PT")).join("");
}

function validConfig() {
  return typeof config.supabaseUrl === "string" &&
    config.supabaseUrl.startsWith("https://") &&
    typeof config.supabaseAnonKey === "string" &&
    config.supabaseAnonKey.length > 20 &&
    !config.supabaseUrl.includes("YOUR-PROJECT") &&
    !config.supabaseAnonKey.includes("YOUR_SUPABASE");
}

async function initialize() {
  if (!validConfig()) {
    const message = "Para ativar o login, configure o URL e a chave pública do Supabase em supabase-config.js. Consulte SUPABASE_SETUP.md.";
    if (page === "login") showAuthError(message);
    else showPageError(message);
    document.querySelectorAll("button, input").forEach((control) => {
      control.disabled = true;
    });
    return;
  }

  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
  } catch (error) {
    console.error("Não foi possível carregar o cliente de autenticação.", error);
    const message = "Não foi possível ligar ao serviço de autenticação. Verifique a ligação à internet e tente novamente.";
    if (page === "login") showAuthError(message);
    else showPageError(message);
    return;
  }

  if (page === "login") {
    setupLoginPage();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("Não foi possível verificar a sessão.", error);
      showAuthError("Não foi possível verificar a sessão. Tente novamente.");
    } else if (data.session) {
      if (!data.session.user.email) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error("Não foi possível terminar a sessão anónima anterior.", signOutError);
          showAuthError("Termine a sessão antiga e volte a tentar.");
        }
      } else {
        await routeUser(data.session.user);
      }
    }
    return;
  }

  await protectDashboard();
}

function setupLoginPage() {
  const loginForm = document.querySelector("#login-form");

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(authError);
    hide(authNotice);
    const identifier = document.querySelector("#login-identifier").value.trim();
    const isEmail = identifier.includes("@");
    const name = isEmail ? "" : identifier.replace(/\s+/g, " ");
    const password = document.querySelector("#login-password").value;
    if (!isEmail && (!name || name.length > 60)) {
      showAuthError("Introduza um nome com, no máximo, 60 caracteres.");
      return;
    }
    const email = isEmail ? identifier : authEmailForName(name);
    if (!email) {
      showAuthError("O nome precisa de conter letras ou números para identificar a conta.");
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthError("Nome/email ou palavra-passe incorretos.");
      return;
    }
    if (!isEmail) {
      const { error: nameError } = await supabase.auth.updateUser({ data: { name } });
      if (nameError) {
        console.error("Não foi possível atualizar o nome do perfil.", nameError);
        showAuthError("A sessão foi iniciada, mas não foi possível atualizar o nome. Tente novamente.");
        return;
      }
    }
    await routeUser(data.user);
  });
}

async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, name, role")
    .eq("id", userId)
    .single();
  if (error) {
    console.error("Não foi possível obter o perfil.", error);
    throw new Error("Não foi possível carregar o perfil. Confirme se a base de dados está configurada.");
  }
  if (data.role !== "admin" && data.role !== "user") {
    throw new Error("A conta não tem um perfil de acesso válido.");
  }
  return data;
}

async function routeUser(user) {
  try {
    const profile = await getProfile(user.id);
    window.location.replace(profile.role === "admin" ? "admin.html" : "user.html");
  } catch (error) {
    showAuthError(error.message);
  }
}

async function protectDashboard() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    window.location.replace("index.html");
    return;
  }
  if (!data.user.email) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) console.error("Não foi possível terminar a sessão anónima anterior.", signOutError);
    window.location.replace("index.html");
    return;
  }

  currentUser = data.user;
  try {
    const profile = await getProfile(currentUser.id);
    const expectedRole = page === "admin" ? "admin" : "user";
    if (profile.role !== expectedRole) {
      window.location.replace(profile.role === "admin" ? "admin.html" : "user.html");
      return;
    }
    currentUserName = profile.name || profile.email || "Utilizador";
    const accountLabel = document.querySelector("#account-name") || accountEmail;
    accountLabel.textContent = page === "user" ? currentUserName : (profile.email || profile.name);
  } catch (error) {
    console.error("Não foi possível validar as permissões da conta.", error);
    showPageError(error.message);
    return;
  }

  document.querySelector("#sign-out").addEventListener("click", async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error("Não foi possível terminar a sessão.", signOutError);
      showPageError("Não foi possível terminar a sessão. Tente novamente.");
      return;
    }
    window.location.replace("index.html");
  });

  document.querySelector("#search").addEventListener("input", renderContacts);
  if (page === "admin") setupAdmin();
  await refreshContacts();
  if (page === "user") {
    await refreshCallHistory();
    window.setInterval(renderCallActivity, 30_000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshCallHistory();
    });
  }
}

function renderContacts() {
  const list = document.querySelector("#contact-list");
  const search = document.querySelector("#search");
  const empty = document.querySelector("#empty-state");
  const noResults = document.querySelector("#no-results");
  const query = normalize(search.value.trim());
  const filtered = contacts
    .filter((contact) => normalize(contact.name + " " + contact.phone + " " + (contact.contact_year ?? "")).includes(query))
    .sort((a, b) => {
      const yearDifference = (a.contact_year ?? Number.POSITIVE_INFINITY) - (b.contact_year ?? Number.POSITIVE_INFINITY);
      return yearDifference || a.name.localeCompare(b.name, "pt-PT");
    });

  list.replaceChildren();
  let groupYear;
  let groupList;
  filtered.forEach((contact) => {
    if (contact.contact_year !== groupYear) {
      groupYear = contact.contact_year;
      const group = document.createElement("section");
      group.className = "contact-year-group";
      const heading = document.createElement("h3");
      heading.className = "contact-year-heading";
      heading.textContent = groupYear === null ? "Ano por atribuir" : String(groupYear);
      groupList = document.createElement("div");
      groupList.className = "contact-year-list";
      group.append(heading, groupList);
      list.append(group);
    }

    const card = document.createElement("article");
    card.className = "contact-card";
    const row = document.createElement("div");
    row.className = "contact-card-row";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = initials(contact.name);
    const color = avatarColors[contact.name.charCodeAt(0) % avatarColors.length];
    avatar.style.setProperty("--avatar-bg", color[0]);
    avatar.style.setProperty("--avatar-fg", color[1]);

    const info = document.createElement("div");
    info.className = "contact-info";
    let calledMarker;
    if (page === "user") {
      calledMarker = document.createElement("label");
      calledMarker.className = "contact-called-marker";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(contact.called_by_initial);
      checkbox.setAttribute(
        "aria-label",
        contact.called_by_initial
          ? "Ligação assinalada por " + contact.called_by_initial + ". Desmarcar " + contact.name
          : "Assinalar que ligou a " + contact.name
      );
      const mark = document.createElement("span");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = contact.called_by_initial || "";
      calledMarker.append(checkbox, mark);
      checkbox.addEventListener("change", () => setContactCallMark(contact, checkbox));
    }

    const name = document.createElement(page === "user" ? "span" : "p");
    name.className = "contact-name";
    name.textContent = contact.name;
    const phone = document.createElement(page === "user" ? "span" : "p");
    phone.className = "contact-phone";
    phone.textContent = contact.phone;
    let contactActivity;
    if (page === "user") {
      const detailsToggle = document.createElement("button");
      detailsToggle.type = "button";
      detailsToggle.className = "contact-details-toggle";
      detailsToggle.setAttribute("aria-controls", "contact-activity-" + contact.id);
      detailsToggle.setAttribute("aria-expanded", String(expandedContactIds.has(contact.id)));
      detailsToggle.setAttribute("aria-label", "Mostrar chamadas e lembretes de " + contact.name);
      const nameRow = document.createElement("span");
      nameRow.className = "contact-name-row";
      const indicator = document.createElement("span");
      indicator.className = "contact-expand-icon";
      indicator.setAttribute("aria-hidden", "true");
      indicator.textContent = expandedContactIds.has(contact.id) ? "−" : "+";
      nameRow.append(name, indicator);
      detailsToggle.append(nameRow, phone);
      detailsToggle.addEventListener("click", () => {
        if (expandedContactIds.has(contact.id)) {
          expandedContactIds.delete(contact.id);
        } else {
          expandedContactIds.add(contact.id);
        }
        renderCallActivity();
      });
      info.append(detailsToggle);

      contactActivity = document.createElement("div");
      contactActivity.className = "contact-activity";
      contactActivity.id = "contact-activity-" + contact.id;
      contactActivity.dataset.contactId = contact.id;
    } else {
      info.append(name, phone);
    }

    const actions = document.createElement("div");
    actions.className = "contact-actions";
    const call = document.createElement(page === "user" ? "button" : "a");
    call.className = "call-button";
    if (page === "user") {
      call.type = "button";
      call.title = "Registar chamada e ligar";
      call.addEventListener("click", () => startCall(contact));
    } else {
      call.href = "tel:" + contact.phone.replace(/[^\d+]/g, "");
    }
    call.setAttribute("aria-label", "Ligar a " + contact.name);
    call.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7.2 3.5 4.8 4.7a2 2 0 0 0-1 2.2c1.4 6.7 6.6 11.9 13.3 13.3a2 2 0 0 0 2.2-1l1.2-2.4-4.1-2.3-2 2a14 14 0 0 1-5.9-5.9l2-2-2.3-4.1Z"></path></svg>';
    actions.append(call);

    if (page === "user") {
      const message = document.createElement("a");
      message.className = "sms-button";
      message.href = "sms:" + contact.phone.replace(/[^\d+]/g, "");
      message.setAttribute("aria-label", "Enviar SMS a " + contact.name);
      message.title = "Enviar SMS";
      message.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.2A7.5 7.5 0 1 1 20 11.5Z"></path><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"></path></svg>';
      actions.append(message);
    }

    if (page === "admin") {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "delete-button";
      edit.setAttribute("aria-label", "Editar " + contact.name);
      edit.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4.3-.9L19 8.4a2.1 2.1 0 0 0-3-3L5.3 16.1 4 20Z"></path></svg>';
      edit.addEventListener("click", () => editContact(contact));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.setAttribute("aria-label", "Apagar " + contact.name);
      remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"></path></svg>';
      remove.addEventListener("click", () => deleteContact(contact.id));
      actions.append(edit, remove);
    }

    if (calledMarker) row.append(calledMarker);
    row.append(avatar, info, actions);
    card.append(row);
    if (contactActivity) card.append(contactActivity);
    groupList.append(card);
  });

  const count = document.querySelector("#contact-count");
  count.textContent = contacts.length === 0
    ? "Ainda sem contactos"
    : contacts.length + (contacts.length === 1 ? " contacto" : " contactos");
  empty.hidden = contacts.length > 0;
  noResults.hidden = contacts.length === 0 || filtered.length > 0;
  if (page === "user") renderCallActivity();
}

async function refreshContacts() {
  hide(pageError);
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name, phone, contact_year, called_by_initial")
    .order("contact_year", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) {
    console.error("Não foi possível carregar os contactos.", error);
    const schemaUpdateRequired = error.code === "PGRST204" || error.code === "42703";
    document.querySelector("#contact-count").textContent = schemaUpdateRequired
      ? "Atualização do Supabase necessária"
      : "Não foi possível carregar os contactos";
    showPageError(schemaUpdateRequired
      ? "Execute o supabase-schema.sql atualizado no Supabase para ativar a marcação partilhada."
      : "Não foi possível carregar os contactos. Tente novamente mais tarde.");
    return;
  }
  contacts = data;
  renderContacts();
}

async function setContactCallMark(contact, checkbox) {
  const previousState = Boolean(contact.called_by_initial);
  checkbox.disabled = true;
  const { error } = await supabase.rpc("set_contact_call_mark", {
    target_contact_id: contact.id,
    is_called: checkbox.checked
  });
  if (error) {
    console.error("Não foi possível guardar a marcação da chamada.", error);
    checkbox.checked = previousState;
    checkbox.disabled = false;
    showPageError(error.code === "PGRST202"
      ? "Execute o supabase-schema.sql atualizado no Supabase para ativar a marcação partilhada."
      : "Não foi possível guardar a marcação. Tente novamente.");
    return;
  }
  await refreshContacts();
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function activityButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "activity-button" + (className ? " " + className : "");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function startCall(contact) {
  hide(pageError);
  const contactId = typeof contact.contact_name === "string" ? contact.contact_id : contact.id;
  const contactName = contact.contact_name || contact.name;
  const { data, error } = await supabase
    .from("call_logs")
    .insert({
      user_id: currentUser.id,
      contact_id: contactId,
      contact_name: contactName,
      phone: contact.phone
    })
    .select("id, user_id, contact_id, contact_name, phone, attempted_at, outcome, reminder_at, reminder_completed_at, note")
    .single();

  if (error) {
    console.error("Não foi possível registar a tentativa de chamada.", error);
    showPageError("A tentativa não foi registada. Verifique a ligação e tente novamente.");
    return;
  }

  callLogs.unshift(data);
  if (data.contact_id) expandedContactIds.add(data.contact_id);
  renderCallActivity();
  window.location.href = "tel:" + contact.phone.replace(/[^\d+]/g, "");
}

async function refreshCallHistory() {
  const { data, error } = await supabase
    .from("call_logs")
    .select("id, user_id, contact_id, contact_name, phone, attempted_at, outcome, reminder_at, reminder_completed_at, note")
    .order("attempted_at", { ascending: false });

  if (error) {
    console.error("Não foi possível carregar o registo de chamadas.", error);
    showPageError("Não foi possível carregar o registo de chamadas. Tente novamente.");
    return;
  }

  callLogs = data;
  renderCallActivity();
}

function renderCallActivity() {
  if (page !== "user") return;
  const now = Date.now();
  document.querySelectorAll(".contact-activity").forEach((activity) => {
    const contactId = activity.dataset.contactId;
    const expanded = expandedContactIds.has(contactId);
    const toggle = activity.parentElement.querySelector(".contact-details-toggle");
    const indicator = toggle.querySelector(".contact-expand-icon");
    const contactName = toggle.querySelector(".contact-name").textContent;
    activity.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", (expanded ? "Ocultar" : "Mostrar") + " chamadas e lembretes de " + contactName);
    indicator.textContent = expanded ? "−" : "+";
    if (!expanded) return;

    const contactLogs = callLogs.filter((log) => log.contact_id === contactId);
    const pendingReminders = contactLogs.filter((log) => log.outcome === "no_answer" && !log.reminder_completed_at);
    const heading = document.createElement("div");
    heading.className = "contact-activity-heading";
    const title = document.createElement("h4");
    title.textContent = "Chamadas e lembretes";
    const count = document.createElement("span");
    count.className = "contact-activity-count";
    count.textContent = contactLogs.length + (contactLogs.length === 1 ? " chamada" : " chamadas");
    if (pendingReminders.length > 0) {
      count.textContent += " · " + pendingReminders.length + (pendingReminders.length === 1 ? " lembrete" : " lembretes");
    }
    heading.append(title, count);
    activity.replaceChildren(heading);

    if (contactLogs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "contact-activity-empty";
      empty.textContent = "Ainda não há chamadas registadas para este contacto.";
      activity.append(empty);
      return;
    }

    contactLogs.forEach((log) => {
      const item = document.createElement("article");
      item.className = "history-item";
      const symbol = document.createElement("span");
      symbol.className = "history-symbol";
      symbol.setAttribute("aria-hidden", "true");
      symbol.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7.2 3.5 4.8 4.7a2 2 0 0 0-1 2.2c1.4 6.7 6.6 11.9 13.3 13.3a2 2 0 0 0 2.2-1l1.2-2.4-4.1-2.3-2 2a14 14 0 0 1-5.9-5.9l2-2-2.3-4.1Z"></path></svg>';

      const main = document.createElement("div");
      main.className = "activity-main";
      const titleRow = document.createElement("div");
      titleRow.className = "history-title-row";
      const outcomeControl = document.createElement("div");
      outcomeControl.className = "call-outcome-control";
      let noteInput;
      if (log.outcome === "calling") {
        outcomeControl.classList.add("call-outcome-choices");
        noteInput = document.createElement("textarea");
        noteInput.className = "call-note-input";
        noteInput.rows = 2;
        noteInput.maxLength = 1000;
        noteInput.value = callNoteDrafts.get(log.id) || "";
        noteInput.placeholder = "Observações desta chamada (opcional)";
        noteInput.setAttribute("aria-label", "Observações da chamada a " + log.contact_name);
        noteInput.addEventListener("input", () => callNoteDrafts.set(log.id, noteInput.value));

        const answered = document.createElement("button");
        answered.type = "button";
        answered.className = "call-outcome-choice is-answered";
        answered.textContent = "✓";
        answered.title = "Atendeu";
        answered.setAttribute("aria-label", "Marcar chamada a " + log.contact_name + " como atendida");
        answered.addEventListener("click", () => setCallOutcome(log.id, "answered", noteInput.value));

        const noAnswer = document.createElement("button");
        noAnswer.type = "button";
        noAnswer.className = "call-outcome-choice is-no-answer";
        noAnswer.textContent = "×";
        noAnswer.title = "Não atendeu";
        noAnswer.setAttribute("aria-label", "Marcar chamada a " + log.contact_name + " como não atendida");
        noAnswer.addEventListener("click", () => setCallOutcome(log.id, "no_answer", noteInput.value));
        outcomeControl.append(answered, noAnswer);
      } else {
        const mark = document.createElement("span");
        mark.className = "call-outcome-mark " + (log.outcome === "answered" ? "is-answered" : "is-no-answer");
        mark.textContent = log.outcome === "answered" ? "✓" : "×";
        mark.setAttribute("aria-label", log.outcome === "answered" ? "Atendida" : "Não atendeu");
        outcomeControl.append(mark);
      }

      const status = document.createElement("span");
      status.className = "history-status";
      const reminderDue = log.outcome === "no_answer" && new Date(log.reminder_at).getTime() <= now;
      status.textContent = log.outcome === "answered"
        ? "Atendida"
        : log.outcome === "no_answer"
          ? log.reminder_completed_at
            ? "Não atendeu · lembrete concluído"
            : reminderDue
              ? "Não atendeu · lembrete pronto"
              : "Não atendeu · lembrete pendente"
          : "Indique se atendeu";
      if (log.outcome === "answered") status.classList.add("is-answered");
      if (log.outcome === "no_answer") status.classList.add("is-no-answer");
      titleRow.append(outcomeControl, status);

      const meta = document.createElement("p");
      meta.className = "activity-meta";
      meta.textContent = formatDateTime(log.attempted_at) + " · " + currentUserName;
      main.append(titleRow, meta);

      if (log.outcome === "no_answer") {
        const note = document.createElement("p");
        note.className = "activity-note";
        const reminderText = log.reminder_completed_at
          ? "Lembrete concluído"
          : reminderDue
            ? "Já pode voltar a ligar"
            : "Lembrete para " + formatDateTime(log.reminder_at);
        note.textContent = "Obs.: " + (log.note || "Não atendeu. Voltar a ligar.") + " · " + reminderText;
        main.append(note);

        if (!log.reminder_completed_at) {
          const actions = document.createElement("div");
          actions.className = "activity-actions";
          actions.append(
            activityButton("Ligar novamente", "primary", () => startCall(log)),
            activityButton("Concluir lembrete", "", () => completeReminder(log.id))
          );
          main.append(actions);
        }
      }

      if (log.outcome === "answered" && log.note && log.note !== "Chamada atendida.") {
        const note = document.createElement("p");
        note.className = "activity-note";
        note.textContent = "Obs.: " + log.note;
        main.append(note);
      }
      if (noteInput) main.append(noteInput);

      item.append(symbol, main);
      activity.append(item);
    });
  });
}

async function setCallOutcome(callId, outcome, note = "") {
  hide(pageError);
  const { error } = await supabase.rpc("set_call_outcome", {
    target_call_id: callId,
    call_outcome: outcome,
    call_note: note.trim()
  });
  if (error) {
    console.error("Não foi possível guardar o resultado da chamada.", error);
    showPageError("Não foi possível guardar o resultado da chamada. Tente novamente.");
    return;
  }
  callNoteDrafts.delete(callId);
  await refreshCallHistory();
}

async function completeReminder(callId) {
  hide(pageError);
  const { error } = await supabase.rpc("complete_call_reminder", {
    target_call_id: callId
  });
  if (error) {
    console.error("Não foi possível concluir o lembrete.", error);
    showPageError("Não foi possível concluir o lembrete. Tente novamente.");
    return;
  }
  await refreshCallHistory();
  showPageNotice("Lembrete concluído.");
}

function setupAdmin() {
  const form = document.querySelector("#contact-form");
  const nameInput = document.querySelector("#contact-name");
  const phoneInput = document.querySelector("#contact-phone");
  const yearInput = document.querySelector("#contact-year");
  const idInput = document.querySelector("#contact-id");
  const formError = document.querySelector("#contact-form-error");

  function openForm(contact) {
    form.hidden = false;
    hide(formError);
    idInput.value = contact ? contact.id : "";
    nameInput.value = contact ? contact.name : "";
    phoneInput.value = contact ? contact.phone : "";
    yearInput.value = contact ? contact.contact_year ?? "" : "";
    document.querySelector("#contact-form-title").textContent = contact ? "Editar contacto" : "Novo contacto";
    form.querySelector(".save-button").textContent = contact ? "Guardar alterações" : "Guardar contacto";
    nameInput.focus();
  }

  function closeForm() {
    form.hidden = true;
    form.reset();
    hide(formError);
  }

  document.querySelector("#show-form").addEventListener("click", () => openForm(null));
  document.querySelector("#empty-add").addEventListener("click", () => openForm(null));
  document.querySelector("#hide-form").addEventListener("click", closeForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(formError);
    const name = nameInput.value.trim().replace(/\s+/g, " ");
    const phone = phoneInput.value.trim();
    const digits = phone.replace(/\D/g, "");
    const contactYear = yearInput.valueAsNumber;
    if (!name) {
      show(formError, "Introduza o nome do contacto.");
      nameInput.focus();
      return;
    }
    if (digits.length < 3 || !/^[+\d\s().-]+$/.test(phone)) {
      show(formError, "Introduza um número de telemóvel válido.");
      phoneInput.focus();
      return;
    }
    if (!Number.isInteger(contactYear) || contactYear < 1 || contactYear > 9999) {
      show(formError, "Introduza um ano válido.");
      yearInput.focus();
      return;
    }

    const contactId = idInput.value;
    const request = contactId
      ? supabase.from("contacts").update({ name, phone, contact_year: contactYear }).eq("id", contactId)
      : supabase.from("contacts").insert({ name, phone, contact_year: contactYear, created_by: currentUser.id });
    const { error } = await request;
    if (error) {
      console.error("Não foi possível guardar o contacto.", error);
      show(formError, "Não foi possível guardar. Verifique os dados e tente novamente.");
      return;
    }
    closeForm();
    await refreshContacts();
    showPageNotice(contactId ? "Contacto atualizado." : "Contacto adicionado.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !form.hidden) closeForm();
  });
}

function editContact(contact) {
  document.querySelector("#contact-id").value = contact.id;
  document.querySelector("#contact-name").value = contact.name;
  document.querySelector("#contact-phone").value = contact.phone;
  document.querySelector("#contact-year").value = contact.contact_year ?? "";
  document.querySelector("#contact-form-title").textContent = "Editar contacto";
  document.querySelector("#contact-form .save-button").textContent = "Guardar alterações";
  document.querySelector("#contact-form").hidden = false;
  document.querySelector("#contact-name").focus();
}

async function deleteContact(id) {
  if (!window.confirm("Quer mesmo apagar este contacto?")) return;
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) {
    console.error("Não foi possível apagar o contacto.", error);
    showPageError("Não foi possível apagar o contacto. Tente novamente.");
    return;
  }
  await refreshContacts();
  showPageNotice("Contacto apagado.");
}

initialize();
