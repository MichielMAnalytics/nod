---
title: Choose a cloud server
description: Choose a VPS for Nod, compare Hetzner, DigitalOcean, and boxd, and understand Railway trial limits.
sidebar:
  order: 3
---

Use a Linux virtual machine with Docker Engine and persistent disk storage. Hetzner, DigitalOcean, and boxd can run the same Nod stack as a Mac mini. Railway has a separate VM sandbox product worth considering for short experiments.

Start with two CPU cores, 8 GB of memory, and 50 GB of disk. This is a starting size, not a measured minimum. Browser tasks and local models can need more capacity.

## Choose a provider

Offers checked on 2026-10-23, and boxd on 2026-11-11. Verify eligibility, remaining credit, and the displayed price before creating resources. Model providers charge separately.

| Provider                                                                      | Use it for                                                                                 | Free offer and limits                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Hetzner Cloud](https://docs.hetzner.com/cloud/general/faq/)                  | A persistent VPS with control over Docker, storage, and firewall rules.                    | Paid hosting. Its referral-credit program has ended; don't rely on old free-credit links.                                                                  |
| [DigitalOcean](https://docs.digitalocean.com/platform/billing/signup-credit/) | A persistent VPS, or a short test covered by signup credit.                                | The first team receives US$5 for 90 days. A valid payment method is required before creating a Droplet. Credit does not make continued hosting free.       |
| [Railway](https://docs.railway.com/pricing/free-trial)                        | A bounded VM experiment when capacity is available.                                        | Anonymous VMs have 2 vCPU, 2 GB RAM, and a 60-minute build window. Registered trials receive US$5 for 30 days. VM lifecycle and memory limits still apply. |
| [boxd](https://boxd.sh/pricing?ref=nod)                                       | A persistent VM with Docker and its own HTTPS address, without a domain or firewall setup. | Paid hosting, billed by use. Check the current rates before creating a machine.                                                                            |

If you need a free-only test, confirm the credit before starting and delete resources before it runs out. Hetzner is not a free-trial option under the terms above.

## Hetzner Cloud

1. Create a project and add your SSH public key. Choose Ubuntu 24.04 on an AMD64 or ARM64 server with at least 8 GB RAM and 50 GB of disk.
2. Check the price before creating it. [Hetzner bills allocated servers even when powered off](https://docs.hetzner.com/cloud/billing/faq/); removing a server and any separately allocated resources ends their charges.
3. Add a cloud firewall allowing SSH from your address. For public HTTPS, also allow inbound TCP 80 and 443.
4. Connect through SSH and [install Docker Engine with Compose](https://docs.docker.com/engine/install/ubuntu/).
5. Follow [Host your own server](/deploy/self-host/). Open an SSH tunnel before local browser access, or configure a domain and HTTPS.

Use Nod's [backup procedure](/deploy/server-operations/#back-up) to preserve the database, files, and keys together. Keep a copy outside the VM.

## DigitalOcean

1. Check the [signup credit](https://docs.digitalocean.com/platform/billing/signup-credit/) in the Control Panel. Older guides advertising a standard US$200 credit do not describe the current offer.
2. [Create a Droplet](https://docs.digitalocean.com/products/droplets/how-to/create/) with Ubuntu 24.04, at least two vCPUs, 8 GB RAM, and 50 GB persistent disk. Add your SSH public key. Check the hourly price and any optional paid resources before creation.
3. Add a cloud firewall allowing SSH from your address. For public HTTPS, also allow inbound TCP 80 and 443.
4. Connect through SSH, [install Docker Engine with Compose](https://docs.docker.com/engine/install/ubuntu/), and follow [Host your own server](/deploy/self-host/).
5. For a disposable test, export a backup and remove the Droplet and related resources before the credit expires or runs out.

The normal Nod stack includes PostgreSQL. A managed database is optional and is not needed for this setup.

## Railway: understand the VM limits

Railway's [Sandboxes](https://docs.railway.com/sandboxes) are Linux VMs, separate from its ordinary deployed services. They [include a Docker daemon and CLI](https://railway.com/changelog/2026-06-12-docker-in-sandboxes), so running sibling containers is possible. Deploying Nod's server image as an ordinary Railway service alone does not create its Docker runtime, browser, or workspace.

Free and Trial Sandboxes are limited to two vCPUs and 2 GB RAM. They are destroyed after up to five idle minutes; only paid plans can disable that timeout. Active SSH, port-forwarding, or command sessions defer idle destruction. Background containers alone do not. Checkpoints preserve a disk snapshot, but they are not a replacement for a consistent database backup.

Railway also offers an [anonymous VM](https://railway.com/free-vm):

```sh title="Terminal"
ssh railway.new
```

It requires no account or card, identifies you by your SSH key, and gives you 60 minutes to build. There is then a 24-hour window to claim the VM; unclaimed files are deleted. The preview URL is restricted to your IP until claimed. Availability is capacity-dependent. This is a separate trial flow: its page does not guarantee a disk size or list Docker among its installed tools.

Before transferring Nod, check the VM:

```sh title="Remote terminal"
df -h
free -m
docker version
docker compose version
```

Use the [prebuilt bundle](/deploy/self-host/#install-a-prebuilt-bundle) matching the VM's Linux architecture. A 2 GB VM may run out of memory when building from source, and a successful installation does not establish that it has enough memory for your browser tasks. Keep the server configuration and token private.

Use a persistent VPS for an unattended assistant. Don't keep the only copy of your conversation, credentials, or files in a disposable trial VM. These Railway instructions describe the platform constraints; they do not establish a verified Nod deployment there.

## boxd

[boxd](https://boxd.sh/?ref=nod) machines are Ubuntu 24.04 VMs with Docker Engine, Compose, and a persistent 100 GB disk. Each machine gets its own HTTPS address, such as `https://<name>.boxd.sh`. boxd's proxy ends TLS there and forwards requests to port 8000 on the machine, so Nod needs no domain, Caddy, or firewall rules.

1. [Install the boxd CLI](https://docs.boxd.sh/cli/installation?ref=nod) on your computer and sign in. Check the [rates](https://boxd.sh/pricing?ref=nod) before creating a machine.
2. Create a machine. The default size is two vCPUs and 8 GB RAM.

   ```sh title="Your computer"
   boxd machine new nod --isolated --auto-suspend-timeout=0 --auto-hibernate-timeout=0
   ```

   `--isolated` keeps boxd's CLI, credentials, and metadata endpoint off the machine, so nothing on it can reach your boxd account. `--auto-suspend-timeout=0` and `--auto-hibernate-timeout=0` keep the machine running when nobody uses Nod, so schedules run on time.

3. Open a shell on the machine and generate the configuration.

   ```sh title="Your computer"
   boxd connect nod
   ```

   ```sh title="Remote terminal"
   git clone https://github.com/n8n-io/nod.git
   cd nod/deployment/self-host
   sh setup.sh
   ```

4. Edit `.env` so Nod listens on port 8000 and uses the machine's address. The address is `https://<name>.boxd.sh`, or `https://<name>.nyc.boxd.sh` for a machine in New York.

   ```sh title=".env"
   PORT=8000
   NOD_BIND_ADDRESS=0.0.0.0
   NOD_PUBLIC_URL=https://<name>.boxd.sh
   ```

   boxd's proxy connects to the machine over its network, so Nod listens on all interfaces. On an isolated machine, port 8000 is reachable only through the HTTPS address.

5. Build and start the stack, as in [Build from source](/deploy/self-host/#build-from-source).

   ```sh title="Remote terminal"
   docker compose up -d --build --wait
   ```

6. Open the machine's address and enter `NOD_AUTH_TOKEN` from `.env`. Finish onboarding to connect a model.

The address is public, and the server token protects it. Don't start Nod's `https` profile on the machine. boxd already serves HTTPS, and a service on port 80 or 443 would take over the address.

Use Nod's [backup procedure](/deploy/server-operations/#back-up) and keep a copy outside the machine. Removing the machine with `boxd machine remove nod -y` deletes its disk and everything on it.

## Other cloud accounts

The same installation works on a conventional Ubuntu VM from another provider. If you already have an eligible trial, these are alternatives:

| Provider                                                                                           | Suggested starting VM                                 | Trial terms                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [AWS Free plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) | Ubuntu 24.04, `m7i-flex.large`, 50 GB EBS.            | Eligible new customers receive US$100 plus up to US$100 through activities. Choose **Free plan**. It ends after six months or credit exhaustion. |
| [Google Cloud](https://docs.cloud.google.com/free/docs/free-cloud-features)                        | Ubuntu 24.04, `e2-standard-2`, 50 GB persistent disk. | Eligible new customers receive US$300 for 90 days. Keep the trial plan; resources stop unless you upgrade.                                       |

Check [EC2 free-tier eligibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html) or [Google's machine sizes](https://docs.cloud.google.com/compute/docs/general-purpose-machines#e2_machine_types) before choosing a VM. Small always-free machines have less memory than the starting size above. An existing paid account follows different billing rules.

## Finish the network setup

On boxd, skip this section. The machine's HTTPS address replaces the domain and firewall setup.

For public access, point a domain at the VM and use [Nod's HTTPS setup](/deploy/self-host/#add-public-https). Open only ports 80 and 443 for the proxy and keep SSH restricted. An SSH tunnel works without a domain.

Docker warns that published container ports can bypass `ufw` rules. Use the provider firewall too, and don't publish PostgreSQL, the browser, the workspace, or the Docker API. See [Docker's firewall limitations](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

Before a trial expires, export a backup and decide whether to move or keep the server. Stopping a VM can leave disks and addresses allocated. Follow the provider's removal flow when you finish a disposable test.

## Related resources

- [Deploy and operate](/deploy/)
- [Host your own server](/deploy/self-host/)
- [Back up and update a server](/deploy/server-operations/)
- [Host on a Mac mini](/deploy/mac-mini/)
