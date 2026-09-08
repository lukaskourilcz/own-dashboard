do $$
declare
  owner_id uuid;
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Expected one OwnDashboard owner; refusing to seed saved positions';
  end if;

  select id into owner_id from auth.users limit 1;

  insert into public.saved_job_positions (user_id, title, company, url, source, location, description)
  select owner_id, title, company, url, 'curated', location, description
  from (values
    ('Remote Full-stack Developer (React + Node.js)', 'Sudolabs Technologie', 'https://www.startupjobs.cz/nabidka/69505/remote-full-stack-developer-react-node-js', 'Czechia / Slovakia · remote', 'React and Node.js product development, code review, pair programming, delivery ownership and client communication.'),
    ('React vývojář', 'Popron Systems · Veolia group', 'https://www.popronsystems.cz/kariera/react-vyvojar/', 'Praha 5 · hybrid', 'TypeScript and React work on dynamic interfaces, reusable components, workflows and REST integrations for the FLOWIO platform.'),
    ('Full Stack Engineer - EMEA', 'Deel', 'https://cz.linkedin.com/jobs/view/full-stack-engineer-emea-at-deel-4455898471', 'Czechia · remote', 'Full-stack TypeScript role across React, Express APIs and PostgreSQL for a global payroll and HR platform.'),
    ('Front-End Developer', 'Ubiquiti Inc.', 'https://cz.linkedin.com/jobs/view/front-end-developer-at-ubiquiti-inc-4420465535', 'Prague · hybrid', 'Frontend role using TypeScript, React, TanStack and Vite with real-time data, design systems, accessibility and testing.'),
    ('Full Stack Product Engineer - Remote/Europe', 'Jiga', 'https://cz.linkedin.com/jobs/view/full-stack-product-engineer-remote-europe-at-jiga-4459384178', 'Europe · remote', 'End-to-end product engineering across React interfaces, Node.js services, data modelling, security and performance.'),
    ('Full Stack Software Engineer', 'Lightdash', 'https://cz.linkedin.com/jobs/view/full-stack-software-engineer-at-lightdash-4113901987', 'Czechia · remote (GMT ±3)', 'Full-stack role using TypeScript, React, Node.js, SQL, Express, Docker and Google Cloud for an open-source data product.'),
    ('Vývojář / developer / AI orchestrator', 'ORGREZ DATA', 'https://cz.linkedin.com/jobs/view/v%C3%BDvoj%C3%A1%C5%99-developer-ai-orchestrator-at-orgrez-data-s-r-o-4461473153', 'Prague or Brno · hybrid', 'Backend-leaning TypeScript and Node.js role with PostgreSQL, Prisma, React, AI integrations and IoT data.'),
    ('Software Engineer - Frontend - Payments', 'Kraken', 'https://cz.linkedin.com/jobs/view/software-engineer-frontend-payments-at-kraken-4456013072', 'Czechia · remote', 'Frontend payments role using React, TypeScript, Next.js, REST APIs and WebSockets in a regulated financial product.')
  ) as selected(title, company, url, location, description)
  on conflict (user_id, url) do nothing;
end;
$$;
