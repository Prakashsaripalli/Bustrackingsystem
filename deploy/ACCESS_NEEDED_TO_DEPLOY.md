# Access Needed So I Can Deploy It

I can prepare the project here, but real deployment needs access to your public server and domain.

## Required

1. Real domain name:

```text
adityauniversitybustracking.com
```

or:

```text
adityauniversitybustracking.in
```

2. Ubuntu VPS/server public IP:

```text
example: 13.201.10.25
```

3. SSH login:

```text
ssh ubuntu@SERVER_IP
```

4. Git repository URL for this project, or another way to upload the files:

```text
https://github.com/username/repo.git
```

5. Production database choice:

- Use PostgreSQL on the same VPS, or
- Use managed PostgreSQL.

6. Email for HTTPS certificate:

```text
admin@example.com
```

## DNS Records To Create

At your domain provider:

```text
Type: A
Name: @
Value: SERVER_PUBLIC_IP

Type: A
Name: www
Value: SERVER_PUBLIC_IP
```

## One-Command Deploy On Ubuntu

After DNS and server are ready:

```bash
REPO_URL=https://github.com/username/repo.git \
DOMAIN=adityauniversitybustracking.com \
WWW_DOMAIN=www.adityauniversitybustracking.com \
DB_PASSWORD='change_this_password' \
JWT_SECRET='change_this_long_random_secret' \
sudo -E bash deploy/deploy-ubuntu.sh
```

Then enable HTTPS:

```bash
EMAIL=admin@example.com \
DOMAIN=adityauniversitybustracking.com \
WWW_DOMAIN=www.adityauniversitybustracking.com \
sudo -E bash deploy/setup-https.sh
```
