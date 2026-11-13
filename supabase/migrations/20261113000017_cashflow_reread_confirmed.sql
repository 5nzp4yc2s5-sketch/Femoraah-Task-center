-- OpsPulse Workspace: Cash Flow, "Read again" also completes confirmed transactions (13-Nov-2026).
--
-- Read again now fills in a reference number or payee that is still blank on a transaction from a
-- bank email even after it was confirmed, as long as the email shows the same amount and direction.
-- Each such fill-in on a confirmed transaction is written to the history (fin_events). Nothing that
-- is already filled in is overwritten. When an email now reads differently from its transaction, the
-- alert gets a note asking for a check and the transaction is left as it is.
--
-- Safe for a live database: replaces one function with the same inputs and outputs. No row is removed.

-- Takes what the server read again from emails already on file (same list as fin_gmail_record).
-- Used only by the app server (service role).
create or replace function public.fin_gmail_reread(p_connection uuid, p_actor uuid, p_alerts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.fin_gmail_connections;
  a public.fin_gmail_alerts;
  t public.fin_transactions;
  v_new_ref text;
  v_new_who text;
  r record;
  v_status text;
  v_last4 text;
  v_ref text;
  v_who text;
  v_acc uuid;
  v_matches integer;
  v_counts jsonb := '{"read": 0, "filled_in": 0, "recorded": 0, "balance_only": 0, "duplicate": 0, "no_account": 0, "unreadable": 0, "differs": 0, "unchanged": 0}'::jsonb;
begin
  select * into c from public.fin_gmail_connections where id = p_connection and disconnected_at is null;
  if c.id is null then raise exception 'Mailbox connection not found' using errcode = 'P0002'; end if;
  if p_actor is not null and not exists (select 1 from public.members m where m.id = p_actor and m.is_active) then
    raise exception 'Unknown team member' using errcode = '22023';
  end if;

  for r in
    select * from jsonb_to_recordset(case when jsonb_typeof(p_alerts) = 'array' then p_alerts else '[]'::jsonb end)
      as x(message_id text, received_at timestamptz, sender text, subject text, readable boolean, direction text, amount_paise bigint,
           last4 text, reference_no text, counterparty text, balance_paise bigint, note text)
  loop
    select * into a from public.fin_gmail_alerts where message_id = r.message_id and connection_id = p_connection for update;
    continue when a.id is null;
    v_counts := jsonb_set(v_counts, '{read}', to_jsonb((v_counts->>'read')::integer + 1));
    v_last4 := case when coalesce(r.last4, '') ~ '^[0-9]{4}$' then r.last4 else '' end;
    v_ref := left(btrim(coalesce(r.reference_no, '')), 80);
    v_who := left(btrim(coalesce(r.counterparty, '')), 120);

    if a.status in ('recorded', 'balance_only', 'duplicate') then
      select * into t from public.fin_transactions where id = a.transaction_id and voided_at is null for update;
      if t.id is null then
        v_counts := jsonb_set(v_counts, '{unchanged}', to_jsonb((v_counts->>'unchanged')::integer + 1));
        continue;
      end if;
      -- The email now reads differently from the transaction: say so on the alert, change nothing.
      if not (coalesce(r.readable, false) and r.direction in ('in', 'out') and coalesce(r.amount_paise, 0) > 0)
         or r.amount_paise <> t.amount_paise or r.direction <> t.direction then
        update public.fin_gmail_alerts
           set note = left(case
             when coalesce(r.readable, false) and r.direction in ('in', 'out') and coalesce(r.amount_paise, 0) > 0
               then 'Read again: this email says ' || case r.direction when 'in' then 'money in' else 'money out' end || ' of ₹'
                    || to_char(r.amount_paise / 100.0, 'FM999999999990.00') || '. Check the transaction'
             else 'Read again: this email no longer shows a payment'
                  || coalesce(' (' || nullif(btrim(r.note), '') || ')', '') || '. Check the transaction' end, 300)
         where id = a.id;
        v_counts := jsonb_set(v_counts, '{differs}', to_jsonb((v_counts->>'differs')::integer + 1));
        continue;
      end if;
      -- Same amount and direction: fill in only a reference or payee that is still blank. This also
      -- applies to a confirmed transaction, and each such fill-in is written to the history.
      v_new_ref := case when t.reference_no = '' and v_ref <> ''
                         and not exists (select 1 from public.fin_transactions o where o.account_id = t.account_id and o.id <> t.id
                                           and lower(o.reference_no) = lower(v_ref) and o.voided_at is null)
                        then v_ref else t.reference_no end;
      v_new_who := case when t.counterparty = '' then v_who else t.counterparty end;
      if v_new_ref <> t.reference_no or v_new_who <> t.counterparty then
        update public.fin_transactions
           set reference_no = v_new_ref, counterparty = v_new_who, updated_by = coalesce(p_actor, updated_by), updated_at = now()
         where id = t.id;
        if t.review_status <> 'needs_review' then
          insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
          values ('transaction', t.id, 'details_filled', p_actor, jsonb_build_object(
            'by', 'read_again', 'reference_no', jsonb_build_object('before', t.reference_no, 'after', v_new_ref),
            'counterparty', jsonb_build_object('before', t.counterparty, 'after', v_new_who)));
        end if;
        update public.fin_gmail_alerts
           set reference_no = case when reference_no = '' then v_ref else reference_no end,
               counterparty = case when counterparty = '' then v_who else counterparty end
         where id = a.id;
        v_counts := jsonb_set(v_counts, '{filled_in}', to_jsonb((v_counts->>'filled_in')::integer + 1));
      else
        v_counts := jsonb_set(v_counts, '{unchanged}', to_jsonb((v_counts->>'unchanged')::integer + 1));
      end if;
      continue;
    end if;

    -- Set aside, or already handled by a person: leave it.
    if a.status not in ('no_account', 'unreadable') or a.handled_at is not null then
      v_counts := jsonb_set(v_counts, '{unchanged}', to_jsonb((v_counts->>'unchanged')::integer + 1));
      continue;
    end if;

    -- Not used yet: work it out afresh, exactly as a first read would.
    v_status := case
      when coalesce(r.readable, false) and ((r.direction in ('in', 'out') and r.amount_paise > 0) or r.balance_paise is not null) then 'no_account'
      else 'unreadable' end;
    update public.fin_gmail_alerts
       set status = v_status,
           direction = case when v_status = 'no_account' and r.direction in ('in', 'out') and r.amount_paise > 0 then r.direction end,
           amount_paise = case when v_status = 'no_account' and r.direction in ('in', 'out') and r.amount_paise > 0 then r.amount_paise end,
           last4 = v_last4, reference_no = v_ref, counterparty = v_who,
           balance_paise = case when v_status = 'no_account' then r.balance_paise end,
           note = case when v_status = 'unreadable'
                       then coalesce(nullif(left(btrim(coalesce(r.note, '')), 300), ''), 'The app could not read the amount from this email') else '' end
     where id = a.id;

    if v_status = 'no_account' then
      v_acc := null;
      v_matches := 0;
      if v_last4 <> '' then
        select count(*), min(x.id::text)::uuid into v_matches, v_acc
          from public.fin_accounts x where x.archived_at is null and (x.last4 = v_last4 or x.card_last4 = v_last4);
      end if;
      if v_matches = 1 then
        v_status := private.fin_gmail_apply(a.id, v_acc, p_actor);
      else
        update public.fin_gmail_alerts
           set note = case
             when v_last4 = '' then 'The email does not say which account. Choose one'
             when v_matches = 0 then 'No bank account or debit card in use ends in ' || v_last4 || '. Choose the account it belongs to'
             else 'More than one bank account or card ends in ' || v_last4 || '. Choose one' end
         where id = a.id;
      end if;
    end if;
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb((v_counts->>v_status)::integer + 1));
  end loop;

  insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
  values ('gmail', p_connection, 'read_again', p_actor, v_counts);
  return v_counts;
end $$;

revoke execute on function public.fin_gmail_reread(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fin_gmail_reread(uuid, uuid, jsonb) to service_role;
