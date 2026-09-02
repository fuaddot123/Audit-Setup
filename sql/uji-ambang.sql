update public.display_standar set maks_hari_pajang=60, peringatan_sebelum_hari=10 where id=1;
insert into public.display_standar_brand (brand,maks_hari_pajang) values ('ASUS',30) on conflict (brand) do update set maks_hari_pajang=30;
insert into public.display_unit (branch_id,brand,model,serial_number,tanggal_pajang,dicatat_oleh) values
 (5,'ASUS','Uji-22hr','SN-A22', current_date-22,'22222222-2222-2222-2222-222222222222'),
 (5,'ASUS','Uji-19hr','SN-A19', current_date-19,'22222222-2222-2222-2222-222222222222'),
 (5,'Lenovo','Uji-52hr','SN-L52',current_date-52,'22222222-2222-2222-2222-222222222222'),
 (5,'Lenovo','Uji-49hr','SN-L49',current_date-49,'22222222-2222-2222-2222-222222222222')
on conflict do nothing;
\echo 'ASUS batas 30 (peringatan mulai H-10 = hari ke-20) | Lenovo batas 60 (mulai hari ke-50)'
select model, brand, umur_hari, batas_hari, (batas_hari - 10) as mulai_diingatkan, status_umur
from public.v_display_monitoring where serial_number like 'SN-%' and model like 'Uji-%'
order by brand, umur_hari desc;
