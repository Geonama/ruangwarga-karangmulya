# Panduan AWS Console - RuangWarga Karangmulya

Panduan ini dibuat untuk mengerjakan Evaluasi 2 dari nol lewat AWS Console. Ikuti urutan ini pelan-pelan. Jangan loncat, karena ECS, RDS, S3, CloudFront, ECR, dan GitHub Actions saling terhubung.

## 0. Hasil akhir yang harus kamu punya

- URL website CloudFront, contoh: `https://dxxxxx.cloudfront.net`
- URL health API, contoh: `https://dxxxxx.cloudfront.net/health`
- ECS Service aktif dan task status `RUNNING`
- Docker image tersimpan di ECR
- Database RDS PostgreSQL berada di private subnet
- File upload masuk ke bucket S3 upload
- GitHub Actions bisa build Docker image, push ke ECR, deploy ke ECS, upload static file ke S3, dan invalidate CloudFront

## 1. Nama resource yang dipakai

Pakai nama ini agar tidak bingung saat memilih resource di console.

| Komponen | Nama |
| --- | --- |
| Region | `ap-southeast-1` |
| VPC | `ruangwarga-vpc` |
| ECS Cluster | `ruangwarga-cluster` |
| ECS Service | `ruangwarga-service` |
| Task Definition | `ruangwarga-api-task` |
| Container | `ruangwarga-api` |
| ECR Repository | `ruangwarga-api` |
| RDS DB Identifier | `ruangwarga-db` |
| Database Name | `ruangwarga` |
| Static Bucket | `ruangwarga-static-NAMA-NRP` |
| Upload Bucket | `ruangwarga-uploads-NAMA-NRP` |
| Load Balancer | `ruangwarga-alb` |

Ganti `NAMA-NRP` dengan nama pendek atau NRP kamu. Nama bucket S3 harus unik global dan huruf kecil semua.

## 2. Push project ke GitHub

1. Buka GitHub, buat repository baru: `ruangwarga-karangmulya`.
2. Di terminal PowerShell:

```powershell
cd "C:\Users\ggmin\Documents\SEMESTER 8\CLOUD\EVALUASI 2"
git init
git branch -M main
git add .
git commit -m "Initial RuangWarga AWS deployment"
git remote add origin https://github.com/USERNAME/ruangwarga-karangmulya.git
git push -u origin main
```

Kalau Git belum terpasang, pakai GitHub Desktop: pilih folder project ini, buat repository, lalu publish ke GitHub.

## 3. Buat VPC

1. AWS Console, pilih region `Asia Pacific (Singapore) ap-southeast-1`.
2. Buka `VPC`.
3. Klik `Create VPC`.
4. Pilih `VPC and more`.
5. Isi:
   - Name tag auto-generation: `ruangwarga`
   - IPv4 CIDR: `10.0.0.0/16`
   - Number of Availability Zones: `2`
   - Public subnets: `2`
   - Private subnets: `2`
   - NAT gateways: `None` untuk hemat biaya
   - VPC endpoints: `None`
   - DNS hostnames dan DNS resolution: aktif
6. Klik `Create VPC`.

Catatan: ECS kita letakkan di public subnet agar bisa menarik image ECR tanpa NAT Gateway. RDS tetap di private subnet.

## 4. Buat Security Group

Buka `VPC > Security groups`.

### 4.1 ALB security group

1. Create security group.
2. Name: `ruangwarga-alb-sg`
3. VPC: `ruangwarga-vpc`
4. Inbound rules:
   - HTTP, port `80`, source `0.0.0.0/0`
5. Outbound: biarkan default `All traffic`.

### 4.2 ECS security group

1. Create security group.
2. Name: `ruangwarga-ecs-sg`
3. VPC: `ruangwarga-vpc`
4. Inbound rules:
   - Custom TCP, port `3000`, source pilih security group `ruangwarga-alb-sg`
5. Outbound: default `All traffic`.

### 4.3 RDS security group

1. Create security group.
2. Name: `ruangwarga-rds-sg`
3. VPC: `ruangwarga-vpc`
4. Inbound rules:
   - PostgreSQL, port `5432`, source pilih security group `ruangwarga-ecs-sg`
5. Outbound: default.

## 5. Buat S3 Bucket

Buka `S3 > Buckets`.

### 5.1 Bucket static website

1. Create bucket.
2. Name: `ruangwarga-static-NAMA-NRP`
3. Region: `ap-southeast-1`
4. Block all public access: tetap ON.
5. Bucket versioning: boleh OFF.
6. Create bucket.

### 5.2 Bucket upload file warga

1. Create bucket.
2. Name: `ruangwarga-uploads-NAMA-NRP`
3. Region: `ap-southeast-1`
4. Block all public access: tetap ON.
5. Create bucket.

## 6. Buat RDS PostgreSQL private

### 6.1 Buat DB subnet group

1. Buka `RDS > Subnet groups`.
2. Klik `Create DB subnet group`.
3. Name: `ruangwarga-db-subnet-group`
4. VPC: `ruangwarga-vpc`
5. Add subnets: pilih 2 private subnet dari 2 AZ.
6. Create.

### 6.2 Buat database

1. Buka `RDS > Databases > Create database`.
2. Pilih `Standard create`.
3. Engine: `PostgreSQL`.
4. Template: `Free tier` jika tersedia. Kalau tidak ada, pilih ukuran paling kecil.
5. DB instance identifier: `ruangwarga-db`
6. Master username: `postgres`
7. Master password: buat password kuat, simpan di catatan pribadi.
8. Instance class: pilih `db.t3.micro` atau `db.t4g.micro` jika tersedia.
9. Storage: `20 GiB`, autoscaling boleh OFF untuk hemat.
10. Connectivity:
    - VPC: `ruangwarga-vpc`
    - DB subnet group: `ruangwarga-db-subnet-group`
    - Public access: `No`
    - VPC security group: pilih `ruangwarga-rds-sg`
11. Additional configuration:
    - Initial database name: `ruangwarga`
12. Create database.

Tunggu status database menjadi `Available`, lalu buka tab `Connectivity & security` dan salin `Endpoint`. Endpoint ini nanti menjadi `DB_HOST`.

## 7. Simpan password RDS di Secrets Manager

1. Buka `Secrets Manager > Store a new secret`.
2. Secret type: `Other type of secret`.
3. Pilih tab `Plaintext`.
4. Isi hanya password RDS kamu, tanpa JSON.
5. Name: `ruangwarga/db/password`
6. Store.
7. Buka secret tersebut dan salin `Secret ARN`. Ini dipakai untuk GitHub secret `DB_PASSWORD_ARN`.

## 8. Buat IAM Role untuk ECS

### 8.1 Task role untuk upload S3

1. Buka `IAM > Roles > Create role`.
2. Trusted entity: `AWS service`.
3. Use case: `Elastic Container Service > Elastic Container Service Task`.
4. Role name: `ruangwargaTaskRole`.
5. Setelah role dibuat, buka role itu.
6. Add permissions > Create inline policy.
7. Pilih JSON, isi dari file [aws/iam-task-role-policy.json](aws/iam-task-role-policy.json).
8. Ganti `YOUR_UPLOAD_BUCKET_NAME` dengan nama bucket upload kamu.
9. Save policy.

### 8.2 Execution role untuk pull image dan baca secret

1. Di `IAM > Roles`, cari `ecsTaskExecutionRole`.
2. Jika belum ada, create role:
   - Trusted entity: ECS Task
   - Attach policy: `AmazonECSTaskExecutionRolePolicy`
   - Role name: `ecsTaskExecutionRole`
3. Buka `ecsTaskExecutionRole`.
4. Add permissions > Create inline policy.
5. JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "SECRET_ARN_PASSWORD_RDS"
    }
  ]
}
```

Ganti `SECRET_ARN_PASSWORD_RDS` dengan ARN dari Secrets Manager.

## 9. Buat ECR repository dan push Docker image

1. Buka `ECR > Private repositories`.
2. Create repository.
3. Repository name: `ruangwarga-api`
4. Create.
5. Buka repository, klik `View push commands`.
6. Jalankan command yang muncul di PowerShell dari folder project ini.

Contoh bentuk command:

```powershell
cd "C:\Users\ggmin\Documents\SEMESTER 8\CLOUD\EVALUASI 2"
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com
docker build -t ruangwarga-api .
docker tag ruangwarga-api:latest ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/ruangwarga-api:latest
docker push ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/ruangwarga-api:latest
```

Sebelum menjalankan command, buka Docker Desktop dulu sampai statusnya running.

## 10. Buat ECS cluster, task definition, dan service

### 10.1 ECS cluster

1. Buka `ECS > Clusters`.
2. Create cluster.
3. Name: `ruangwarga-cluster`
4. Infrastructure: pilih `AWS Fargate`.
5. Create.

### 10.2 Task definition

1. Buka `ECS > Task definitions > Create new task definition`.
2. Family: `ruangwarga-api-task`
3. Launch type: `AWS Fargate`
4. OS/Architecture: `Linux/X86_64`
5. Task size:
   - CPU: `.25 vCPU`
   - Memory: `.5 GB`
6. Task role: `ruangwargaTaskRole`
7. Task execution role: `ecsTaskExecutionRole`
8. Container:
   - Name: `ruangwarga-api`
   - Image URI: ambil dari ECR, contoh `ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/ruangwarga-api:latest`
   - Container port: `3000`
   - Protocol: TCP
9. Environment variables:
   - `PORT` = `3000`
   - `AWS_REGION` = `ap-southeast-1`
   - `DB_HOST` = endpoint RDS
   - `DB_PORT` = `5432`
   - `DB_NAME` = `ruangwarga`
   - `DB_USER` = `postgres`
   - `DB_SSL` = `false`
   - `S3_UPLOAD_BUCKET` = nama bucket upload
   - `CORS_ORIGIN` = `*`
10. Secrets:
    - Name: `DB_PASSWORD`
    - Value from: ARN secret password RDS
11. Logging: aktifkan CloudWatch logs.
12. Create task definition.

### 10.3 ECS service dan Load Balancer

1. Buka cluster `ruangwarga-cluster`.
2. Create service.
3. Compute options: `Launch type`.
4. Launch type: `Fargate`.
5. Task definition: `ruangwarga-api-task`, revision terbaru.
6. Service name: `ruangwarga-service`.
7. Desired tasks: `1`.
8. Networking:
   - VPC: `ruangwarga-vpc`
   - Subnets: pilih 2 public subnet
   - Security group: `ruangwarga-ecs-sg`
   - Public IP: `Turned on`
9. Load balancing:
   - Type: `Application Load Balancer`
   - Create new ALB: `ruangwarga-alb`
   - Internet-facing
   - Listener: HTTP `80`
   - ALB security group: `ruangwarga-alb-sg`
   - Target group: buat baru
   - Target type: `IP`
   - Protocol: HTTP
   - Port: `3000`
   - Health check path: `/health`
10. Create service.

Tunggu beberapa menit sampai task menjadi `RUNNING` dan target group status `healthy`.

Tes:

```text
http://ALB-DNS-NAME/health
```

Jika muncul `{"ok":true,...}`, ECS sudah berhasil.

## 11. Buat CloudFront untuk static S3 dan API ECS

CloudFront dibuat setelah ALB ada, supaya distribusi punya dua origin: S3 untuk static file dan ALB untuk API.

1. Buka `CloudFront > Distributions > Create distribution`.
2. Origin pertama:
   - Origin domain: pilih bucket static `ruangwarga-static-NAMA-NRP`
   - Origin access: pilih `Origin access control settings`
   - Create OAC baru
3. Default cache behavior:
   - Viewer protocol policy: `Redirect HTTP to HTTPS`
   - Allowed methods: `GET, HEAD`
   - Cache policy: `CachingOptimized`
4. Web Application Firewall: boleh `Do not enable security protections` untuk hemat.
5. Default root object: `index.html`.
6. Create distribution.
7. Setelah dibuat, buka tab `Origins`.
8. Add origin:
   - Origin domain: isi DNS ALB, contoh `ruangwarga-alb-xxx.ap-southeast-1.elb.amazonaws.com`
   - Protocol: `HTTP only`
   - HTTP port: `80`
   - Name: `ruangwarga-alb-origin`
9. Buka tab `Behaviors`.
10. Create behavior untuk API:
    - Path pattern: `/api/*`
    - Origin: `ruangwarga-alb-origin`
    - Viewer protocol policy: `Redirect HTTP to HTTPS`
    - Allowed HTTP methods: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
    - Cache policy: `CachingDisabled`
    - Origin request policy: pilih `AllViewerExceptHostHeader` jika ada. Jika tidak ada, pilih `AllViewer`.
11. Buat behavior kedua:
    - Path pattern: `/health`
    - Origin: `ruangwarga-alb-origin`
    - Allowed methods: `GET, HEAD`
    - Cache policy: `CachingDisabled`
12. CloudFront akan memberi bucket policy untuk OAC. Copy policy itu ke `S3 > static bucket > Permissions > Bucket policy`.

## 12. Upload static website ke S3

Karena `config.js` sudah berisi:

```js
window.RUANGWARGA_API_BASE = ".";
```

Frontend akan memanggil API lewat domain CloudFront yang sama, misalnya `https://dxxxxx.cloudfront.net/api/records`.

Upload file berikut ke bucket static:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- folder `assets`

Cara manual:

1. Buka bucket static di S3.
2. Upload.
3. Add files: pilih 4 file di atas.
4. Add folder: pilih folder `assets`.
5. Upload.

Tunggu CloudFront selesai deploy, lalu buka:

```text
https://DISTRIBUTION-DOMAIN.cloudfront.net
https://DISTRIBUTION-DOMAIN.cloudfront.net/health
```

Tes fitur:

1. Ajukan surat dengan file kecil.
2. Buka menu Lacak, pastikan tiket muncul.
3. Buka menu Admin, ubah status.
4. Buka bucket upload S3, pastikan ada file baru di folder `uploads/`.
5. Buka RDS lewat bukti aplikasi: data harus muncul lagi setelah refresh website.

## 13. Aktifkan GitHub Actions CI/CD

### 13.1 Buat IAM user untuk GitHub Actions

1. Buka `IAM > Users > Create user`.
2. User name: `github-actions-ruangwarga`.
3. Setelah user dibuat, buka tab permissions.
4. Create inline policy.
5. Isi JSON dari [aws/iam-github-actions-policy.json](aws/iam-github-actions-policy.json).
6. Ganti `ACCOUNT_ID` dengan AWS Account ID kamu.
7. Buat access key:
   - Use case: `Command Line Interface`
   - Simpan Access Key ID dan Secret Access Key.

### 13.2 Isi GitHub repository secrets

Buka repository GitHub kamu: `Settings > Secrets and variables > Actions > New repository secret`.

Isi secret berikut:

| Secret | Isi |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | Access key dari IAM user |
| `AWS_SECRET_ACCESS_KEY` | Secret access key dari IAM user |
| `DB_HOST` | Endpoint RDS |
| `DB_NAME` | `ruangwarga` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD_ARN` | ARN secret password RDS |
| `S3_UPLOAD_BUCKET` | Bucket upload |
| `STATIC_BUCKET` | Bucket static |
| `CORS_ORIGIN` | `*` |
| `API_BASE_URL` | `.` |
| `CLOUDFRONT_DISTRIBUTION_ID` | ID distribution CloudFront |

### 13.3 Edit task definition template

Buka file [aws/task-definition.json](aws/task-definition.json), ganti:

- `ACCOUNT_ID` dengan AWS Account ID kamu.
- Jika region kamu bukan `ap-southeast-1`, ganti semua region.

Commit dan push:

```powershell
git add .
git commit -m "Configure AWS ECS deployment"
git push
```

Buka tab `Actions` di GitHub. Workflow harus:

1. Build Docker image.
2. Push ke ECR.
3. Deploy ke ECS.
4. Upload static ke S3.
5. Invalidate CloudFront.

## 14. Bukti yang harus disiapkan untuk laporan

Ambil screenshot:

- CloudFront distribution domain dan behavior `/api/*`
- S3 bucket static dan upload bucket
- Object baru di upload bucket setelah submit form
- ECR repository berisi image
- ECS cluster, service, task `RUNNING`
- Target group `healthy`
- RDS `ruangwarga-db` dengan public access `No`
- GitHub Actions workflow success
- Website CloudFront terbuka
- Menu tracking dan admin menampilkan data

Diagram arsitektur harus kamu gambar manual di draw.io atau diagrams.net karena soal melarang pembuatan diagram dengan AI. Gunakan daftar komponen ini sebagai checklist saja: Internet, CloudFront, S3 static, ALB, ECS Fargate, ECR, RDS private subnet, S3 upload, VPC, public subnet, private subnet, Internet Gateway, GitHub Actions.

## 15. Troubleshooting cepat

### Website terbuka tapi form tidak masuk

- Buka `https://DISTRIBUTION/health`.
- Jika error, cek behavior CloudFront `/api/*` dan origin ALB.
- Cek ECS task logs di CloudWatch.

### ECS task berhenti terus

- Buka ECS task stopped reason.
- Cek env `DB_HOST`, `DB_NAME`, `DB_USER`, dan secret `DB_PASSWORD`.
- Pastikan RDS SG menerima port 5432 dari ECS SG.

### Target group unhealthy

- Pastikan target group port `3000`.
- Health check path harus `/health`.
- ECS SG inbound port 3000 source-nya ALB SG.

### Upload file gagal

- Pastikan task role `ruangwargaTaskRole` punya `s3:PutObject` ke bucket upload.
- Pastikan env `S3_UPLOAD_BUCKET` sesuai nama bucket upload.

### GitHub Actions gagal saat deploy

- Pastikan IAM policy GitHub Actions sudah diganti `ACCOUNT_ID`.
- Pastikan `aws/task-definition.json` juga sudah diganti `ACCOUNT_ID`.
- Pastikan service name `ruangwarga-service` dan cluster `ruangwarga-cluster` sama persis.

## 16. Setelah penilaian selesai

Agar biaya tidak jalan terus, hapus resource ini setelah tidak dibutuhkan:

1. ECS service dan cluster
2. ALB dan target group
3. RDS database
4. NAT Gateway jika kamu sempat membuatnya
5. CloudFront distribution
6. S3 buckets
7. ECR repository
8. IAM user GitHub Actions

## Referensi resmi

- Amazon RDS create DB instance: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html
- Amazon ECR create repository: https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-create.html
- Amazon ECR push image: https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push.html
- Amazon ECS service with load balancer: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/create-service-console-v2.html
- Amazon ECS environment and secrets: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html
- Amazon CloudFront distribution: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-creating-console.html
- CloudFront OAC for S3: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
- AWS ECS GitHub Actions render task definition: https://github.com/aws-actions/amazon-ecs-render-task-definition
- AWS ECS GitHub Actions deploy task definition: https://github.com/aws-actions/amazon-ecs-deploy-task-definition
