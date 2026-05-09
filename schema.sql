create table if not exists service_records (
  id varchar(32) primary key,
  type varchar(32) not null,
  name varchar(160) not null,
  nik varchar(32),
  detail varchar(160) not null,
  location text not null,
  description text,
  file_name varchar(255),
  file_key varchar(512),
  status varchar(32) not null default 'Diterima',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
